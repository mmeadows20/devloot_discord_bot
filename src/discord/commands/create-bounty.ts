import { Injectable, Logger } from '@nestjs/common';
import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  BountyOnboardingService,
  BountyOnboardingSession,
  isBountyDraftComplete,
  parseBountyCustomId,
} from '../services/bounty-onboarding.service';
import {
  BountyPublicationService,
  BountyPublishError,
} from '../services/bounty-publication.service';
import {
  BountyWizardView,
  BountyWizardViews,
} from '../views/bounty-wizard.views';
import {
  isBountyCurrency,
  normalizeSummary,
  normalizeTitle,
  parseDeadline,
  parseGitHubIssueUrl,
  parseRepository,
  parseRewardAmount,
  repositoryMatchesIssue,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../utils/bounty-validation';

type WizardInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;
type RepliableInteraction = ChatInputCommandInteraction | WizardInteraction;

@Injectable()
export class CreateBountyCommand {
  private readonly logger = new Logger(CreateBountyCommand.name);

  constructor(
    private readonly onboarding: BountyOnboardingService,
    private readonly views: BountyWizardViews,
    private readonly publication: BountyPublicationService,
  ) {}

  async handle(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await this.replyError(
          interaction,
          '`/create-bounty` can only be used in a server.',
        );
        return;
      }

      const session = this.onboarding.createSession(
        interaction.user.id,
        interaction.guildId,
      );
      this.logger.log(
        `[create-bounty] Session ${session.id} started by ${interaction.user.id}`,
      );

      await interaction.reply({
        ...this.views.buildIntro(session),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err) {
      this.logger.error(`[create-bounty] Failed to start session: ${err}`);
      await this.replyError(
        interaction,
        'Could not start the bounty wizard. Please try again.',
      );
    }
  }

  async handleButton(
    interaction: ButtonInteraction,
    client: Client,
  ): Promise<boolean> {
    const parsed = parseBountyCustomId(interaction.customId);
    if (!parsed) return false;

    try {
      const session = this.getSessionForInteraction(
        interaction,
        parsed.sessionId,
      );
      if (!session) return true;

      this.onboarding.touch(session.id);

      switch (parsed.action) {
        case 'start':
          session.step = 'title';
          session.returnToPreview = false;
          await interaction.showModal(this.views.buildTitleModal(session));
          break;
        case 'edit:title':
          session.returnToPreview = session.step === 'preview';
          session.step = 'title';
          await interaction.showModal(this.views.buildTitleModal(session));
          break;
        case 'edit:github':
          session.returnToPreview = session.step === 'preview';
          session.step = 'github';
          await interaction.showModal(this.views.buildGithubModal(session));
          break;
        case 'edit:reward':
          session.returnToPreview = session.step === 'preview';
          session.step = 'reward';
          await interaction.update(this.views.buildRewardStep(session));
          break;
        case 'edit:deadline':
          session.returnToPreview = session.step === 'preview';
          session.step = 'deadline';
          await interaction.showModal(this.views.buildDeadlineModal(session));
          break;
        case 'set:amount':
          session.step = 'reward';
          await interaction.showModal(this.views.buildAmountModal(session));
          break;
        case 'set:deadline':
          session.step = 'deadline';
          await interaction.showModal(this.views.buildDeadlineModal(session));
          break;
        case 'continue:reward':
          await this.continueFromReward(interaction, session);
          break;
        case 'continue:deadline':
          session.step = 'preview';
          session.returnToPreview = false;
          await interaction.update(this.views.buildPreview(session));
          break;
        case 'skip:deadline':
          session.draft.deadline = undefined;
          session.step = 'preview';
          session.returnToPreview = false;
          await interaction.update(this.views.buildPreview(session));
          break;
        case 'back:title':
          session.step = 'title';
          session.returnToPreview = false;
          await interaction.update(this.views.buildTitleStep(session));
          break;
        case 'back:github':
          session.step = 'github';
          session.returnToPreview = false;
          await interaction.update(this.views.buildGithubStep(session));
          break;
        case 'back:reward':
          session.step = 'reward';
          session.returnToPreview = false;
          await interaction.update(this.views.buildRewardStep(session));
          break;
        case 'preview':
          session.step = 'preview';
          session.returnToPreview = false;
          await interaction.update(this.views.buildPreview(session));
          break;
        case 'publish':
          await this.publish(interaction, session, client);
          break;
        case 'cancel':
          session.cancelReturnStep = session.step;
          await interaction.update(this.views.buildCancelConfirmation(session));
          break;
        case 'cancel:confirm':
          this.onboarding.deleteSession(session.id);
          await interaction.update(this.views.buildCancelled());
          this.logger.log(
            `[create-bounty] Session ${session.id} cancelled by ${session.userId}`,
          );
          break;
        case 'cancel:abort':
          session.step = session.cancelReturnStep ?? 'intro';
          session.cancelReturnStep = null;
          await interaction.update(this.buildStepView(session));
          break;
        default:
          await this.replyError(interaction, 'Unknown wizard action.');
          break;
      }
    } catch (err) {
      this.logger.error(
        `[create-bounty] Button ${interaction.customId} failed: ${err}`,
      );
      await this.replyError(
        interaction,
        'Something went wrong while updating your draft. Please try again.',
      );
    }

    return true;
  }

  async handleSelectMenu(
    interaction: StringSelectMenuInteraction,
  ): Promise<boolean> {
    const parsed = parseBountyCustomId(interaction.customId);
    if (!parsed) return false;

    try {
      const session = this.getSessionForInteraction(
        interaction,
        parsed.sessionId,
      );
      if (!session) return true;

      this.onboarding.touch(session.id);

      if (parsed.action !== 'currency') {
        await this.replyError(interaction, 'Unknown wizard action.');
        return true;
      }

      const selected = interaction.values[0];
      if (!selected || !isBountyCurrency(selected)) {
        await this.replyError(interaction, 'Unsupported reward token.');
        return true;
      }

      session.draft.currency = selected;
      session.step = 'reward';
      await interaction.update(this.views.buildRewardStep(session));
    } catch (err) {
      this.logger.error(
        `[create-bounty] Select ${interaction.customId} failed: ${err}`,
      );
      await this.replyError(
        interaction,
        'Something went wrong while updating your draft. Please try again.',
      );
    }

    return true;
  }

  async handleModalSubmit(
    interaction: ModalSubmitInteraction,
  ): Promise<boolean> {
    const parsed = parseBountyCustomId(interaction.customId);
    if (!parsed) return false;

    try {
      const session = this.getSessionForInteraction(
        interaction,
        parsed.sessionId,
      );
      if (!session) return true;

      this.onboarding.touch(session.id);

      switch (parsed.action) {
        case 'modal:title':
          await this.handleTitleModal(interaction, session);
          break;
        case 'modal:github':
          await this.handleGithubModal(interaction, session);
          break;
        case 'modal:amount':
          await this.handleAmountModal(interaction, session);
          break;
        case 'modal:deadline':
          await this.handleDeadlineModal(interaction, session);
          break;
        default:
          await this.replyError(interaction, 'Unknown wizard action.');
          break;
      }
    } catch (err) {
      this.logger.error(
        `[create-bounty] Modal ${interaction.customId} failed: ${err}`,
      );
      await this.replyError(
        interaction,
        'Something went wrong while updating your draft. Please try again.',
      );
    }

    return true;
  }

  private async handleTitleModal(
    interaction: ModalSubmitInteraction,
    session: BountyOnboardingSession,
  ): Promise<void> {
    const title = normalizeTitle(
      interaction.fields.getTextInputValue('title'),
    );
    if (!title) {
      await this.replyError(
        interaction,
        `Title must be between ${TITLE_MIN_LENGTH} and ${TITLE_MAX_LENGTH} characters.`,
      );
      return;
    }

    const summary = normalizeSummary(
      interaction.fields.getTextInputValue('summary'),
    );
    if (!summary) {
      await this.replyError(
        interaction,
        `Summary must be between ${SUMMARY_MIN_LENGTH} and ${SUMMARY_MAX_LENGTH} characters.`,
      );
      return;
    }

    session.draft.title = title;
    session.draft.summary = summary;
    await this.finishFieldEdit(interaction, session, 'github');
  }

  private async handleGithubModal(
    interaction: ModalSubmitInteraction,
    session: BountyOnboardingSession,
  ): Promise<void> {
    const repository = parseRepository(
      interaction.fields.getTextInputValue('repository'),
    );
    if (!repository) {
      await this.replyError(
        interaction,
        'Repository must be in `owner/repo` format.',
      );
      return;
    }

    const issue = parseGitHubIssueUrl(
      interaction.fields.getTextInputValue('issue_url'),
    );
    if (!issue) {
      await this.replyError(
        interaction,
        'Issue URL must look like `https://github.com/owner/repo/issues/123`.',
      );
      return;
    }

    if (!repositoryMatchesIssue(repository, issue)) {
      await this.replyError(
        interaction,
        'The repository does not match the issue URL. Check both fields and try again.',
      );
      return;
    }

    session.draft.repository = issue.fullName;
    session.draft.issueUrl = issue.url;
    session.draft.issueNumber = issue.issueNumber;
    await this.finishFieldEdit(interaction, session, 'reward');
  }

  private async handleAmountModal(
    interaction: ModalSubmitInteraction,
    session: BountyOnboardingSession,
  ): Promise<void> {
    const amount = parseRewardAmount(
      interaction.fields.getTextInputValue('amount'),
    );
    if (amount === null) {
      await this.replyError(
        interaction,
        'Enter a positive amount with up to 6 decimal places.',
      );
      return;
    }

    session.draft.rewardAmount = amount;
    session.step = 'reward';
    await this.updateFromModal(
      interaction,
      this.views.buildRewardStep(session),
    );
  }

  private async handleDeadlineModal(
    interaction: ModalSubmitInteraction,
    session: BountyOnboardingSession,
  ): Promise<void> {
    const value = interaction.fields.getTextInputValue('deadline').trim();
    if (value) {
      const deadline = parseDeadline(value);
      if (!deadline) {
        await this.replyError(
          interaction,
          'Deadline must be a future date in `YYYY-MM-DD` format (UTC).',
        );
        return;
      }
      session.draft.deadline = deadline;
    } else {
      session.draft.deadline = undefined;
    }

    if (session.returnToPreview) {
      session.returnToPreview = false;
      session.step = 'preview';
      await this.updateFromModal(
        interaction,
        this.views.buildPreview(session),
      );
      return;
    }

    session.step = 'deadline';
    await this.updateFromModal(
      interaction,
      this.views.buildDeadlineStep(session),
    );
  }

  private async finishFieldEdit(
    interaction: ModalSubmitInteraction,
    session: BountyOnboardingSession,
    nextStep: 'github' | 'reward',
  ): Promise<void> {
    if (session.returnToPreview) {
      session.returnToPreview = false;
      session.step = 'preview';
      await this.updateFromModal(
        interaction,
        this.views.buildPreview(session),
      );
      return;
    }

    session.step = nextStep;
    const view =
      nextStep === 'github'
        ? this.views.buildGithubStep(session)
        : this.views.buildRewardStep(session);
    await this.updateFromModal(interaction, view);
  }

  private async continueFromReward(
    interaction: ButtonInteraction,
    session: BountyOnboardingSession,
  ): Promise<void> {
    if (session.draft.rewardAmount === undefined) {
      await this.replyError(
        interaction,
        'Set a reward amount before continuing.',
      );
      return;
    }

    const goToPreview = session.returnToPreview;
    session.returnToPreview = false;
    session.step = goToPreview ? 'preview' : 'deadline';

    await interaction.update(
      goToPreview
        ? this.views.buildPreview(session)
        : this.views.buildDeadlineStep(session),
    );
  }

  private async publish(
    interaction: ButtonInteraction,
    session: BountyOnboardingSession,
    client: Client,
  ): Promise<void> {
    if (session.publishing) {
      await this.replyError(
        interaction,
        'Publishing is already in progress. Please wait.',
      );
      return;
    }

    const missing = this.missingDraftFields(session);
    if (missing.length > 0) {
      await this.replyError(
        interaction,
        `Your draft is missing: ${missing.join(', ')}.`,
      );
      return;
    }

    session.publishing = true;
    await interaction.deferUpdate();

    try {
      const published = await this.publication.publish(
        session,
        client,
        interaction.guild,
      );
      this.onboarding.deleteSession(session.id);

      await interaction.editReply(
        this.views.buildPublishedConfirmation(
          session,
          published.url,
          published.channelId,
        ),
      );
      this.logger.log(
        `[create-bounty] Session ${session.id} published by ${session.userId}`,
      );
    } catch (err) {
      session.publishing = false;
      const message =
        err instanceof BountyPublishError
          ? err.message
          : 'Could not publish the bounty. Please try again.';
      this.logger.error(
        `[create-bounty] Publish failed for session ${session.id}: ${err}`,
      );

      try {
        await interaction.editReply(this.views.buildPreview(session, message));
      } catch (editErr) {
        this.logger.error(
          `[create-bounty] Failed to show publish error for session ${session.id}: ${editErr}`,
        );
      }
    }
  }

  private getSessionForInteraction(
    interaction: WizardInteraction,
    sessionId: string,
  ): BountyOnboardingSession | null {
    const session = this.onboarding.getSession(sessionId);
    if (!session) {
      void this.respondExpired(interaction);
      return null;
    }

    if (session.userId !== interaction.user.id) {
      void this.replyError(
        interaction,
        'This bounty session belongs to another user.',
      );
      return null;
    }

    return session;
  }

  private async respondExpired(
    interaction: WizardInteraction,
  ): Promise<void> {
    const view = this.views.buildExpired();

    if (interaction.isModalSubmit()) {
      if (interaction.isFromMessage()) {
        await interaction.update(view);
      } else {
        await interaction.reply({
          ...view,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    await interaction.update(view);
  }

  private async updateFromModal(
    interaction: ModalSubmitInteraction,
    view: BountyWizardView,
  ): Promise<void> {
    if (interaction.isFromMessage()) {
      await interaction.update(view);
      return;
    }

    await interaction.reply({
      ...view,
      flags: MessageFlags.Ephemeral,
    });
  }

  private buildStepView(session: BountyOnboardingSession): BountyWizardView {
    switch (session.step) {
      case 'title':
        return this.views.buildTitleStep(session);
      case 'github':
        return this.views.buildGithubStep(session);
      case 'reward':
        return this.views.buildRewardStep(session);
      case 'deadline':
        return this.views.buildDeadlineStep(session);
      case 'preview':
        return this.views.buildPreview(session);
      case 'intro':
      default:
        return this.views.buildIntro(session);
    }
  }

  private missingDraftFields(session: BountyOnboardingSession): string[] {
    if (isBountyDraftComplete(session.draft)) return [];

    const missing: string[] = [];
    if (!session.draft.title) missing.push('title');
    if (!session.draft.summary) missing.push('summary');
    if (
      !session.draft.repository ||
      !session.draft.issueUrl ||
      session.draft.issueNumber === undefined
    ) {
      missing.push('GitHub issue');
    }
    if (session.draft.rewardAmount === undefined) missing.push('reward');
    return missing;
  }

  private async replyError(
    interaction: RepliableInteraction,
    message: string,
  ): Promise<void> {
    const payload: InteractionReplyOptions = {
      content: `⚠️ ${message}`,
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (err) {
      this.logger.warn(
        `[create-bounty] Failed to send error response: ${err}`,
      );
    }
  }
}
