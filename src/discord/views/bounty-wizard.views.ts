import { Injectable } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  BountyDraft,
  BountyOnboardingSession,
  buildBountyCustomId,
  isBountyDraftComplete,
} from '../services/bounty-onboarding.service';
import {
  formatDeadlineInput,
  formatRewardAmount,
  SUPPORTED_CURRENCIES,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../utils/bounty-validation';

export interface BountyWizardView {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

@Injectable()
export class BountyWizardViews {
  buildIntro(session: BountyOnboardingSession): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('Create a Bounty')
      .setDescription(
        'This guided flow will walk you through publishing your first bounty.\n\n' +
          '**Steps**\n' +
          '1. Title and short summary\n' +
          '2. GitHub repository and issue URL\n' +
          '3. Reward amount and token\n' +
          '4. Optional completion deadline\n' +
          '5. Review and publish\n\n' +
          'You can review and edit every field before publishing. ' +
          'Your draft is private and expires after 15 minutes of inactivity.',
      )
      .setFooter({ text: 'Step 1 of 5 • Private session' });

    const row = this.row(
      this.button(session, 'start', 'Start', ButtonStyle.Primary, '🚀'),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  buildTitleStep(session: BountyOnboardingSession): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('Step 1 of 5 — Title & summary')
      .setDescription(
        'Give your bounty a clear title and a short summary that explains the work.',
      )
      .addFields(
        { name: 'Title', value: this.draftValue(session.draft.title) },
        { name: 'Summary', value: this.draftValue(session.draft.summary) },
      )
      .setFooter({ text: 'Step 1 of 5 • Private session' });

    const row = this.row(
      this.button(
        session,
        'edit:title',
        session.draft.title ? 'Edit title & summary' : 'Set title & summary',
        ButtonStyle.Primary,
      ),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  buildGithubStep(session: BountyOnboardingSession): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('Step 2 of 5 — GitHub issue')
      .setDescription(
        'Link the repository and the issue this bounty will resolve. ' +
          'Only public GitHub issue URLs are accepted.',
      )
      .addFields(
        {
          name: 'Repository',
          value: session.draft.repository
            ? `[${session.draft.repository}](https://github.com/${session.draft.repository})`
            : '*Not set*',
        },
        {
          name: 'Issue',
          value:
            session.draft.issueUrl && session.draft.issueNumber
              ? `[#${session.draft.issueNumber}](${session.draft.issueUrl})`
              : '*Not set*',
        },
      )
      .setFooter({ text: 'Step 2 of 5 • Private session' });

    const row = this.row(
      this.button(
        session,
        'edit:github',
        session.draft.issueUrl ? 'Edit GitHub issue' : 'Set GitHub issue',
        ButtonStyle.Primary,
      ),
      this.button(session, 'back:title', 'Back', ButtonStyle.Secondary),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  buildRewardStep(session: BountyOnboardingSession): BountyWizardView {
    const currency = session.draft.currency;
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('Step 3 of 5 — Reward')
      .setDescription(
        'Choose the payout token and enter a positive reward amount.',
      )
      .addFields(
        {
          name: 'Reward',
          value:
            session.draft.rewardAmount !== undefined
              ? `**${formatRewardAmount(session.draft.rewardAmount)} ${currency}**`
              : '*Not set*',
          inline: true,
        },
        { name: 'Token', value: currency, inline: true },
      )
      .setFooter({ text: 'Step 3 of 5 • Private session' });

    const currencySelect = new StringSelectMenuBuilder()
      .setCustomId(buildBountyCustomId(session.id, 'currency'))
      .setPlaceholder('Select reward token')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        SUPPORTED_CURRENCIES.map((supportedCurrency) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(supportedCurrency)
            .setValue(supportedCurrency)
            .setDefault(supportedCurrency === currency),
        ),
      );

    const selectRow = this.row(currencySelect);
    const buttonRow = this.row(
      this.button(
        session,
        'set:amount',
        session.draft.rewardAmount !== undefined ? 'Edit amount' : 'Set amount',
        ButtonStyle.Primary,
      ),
      this.button(
        session,
        'continue:reward',
        'Continue',
        ButtonStyle.Success,
        undefined,
        session.draft.rewardAmount === undefined,
      ),
      this.button(session, 'back:github', 'Back', ButtonStyle.Secondary),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [selectRow, buttonRow] };
  }

  buildDeadlineStep(session: BountyOnboardingSession): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('Step 4 of 5 — Deadline (optional)')
      .setDescription(
        'Set a completion deadline for this bounty, or skip this step.',
      )
      .addFields({
        name: 'Deadline',
        value: this.formatDeadline(session.draft.deadline),
      })
      .setFooter({ text: 'Step 4 of 5 • Private session' });

    const row = this.row(
      this.button(
        session,
        'set:deadline',
        session.draft.deadline ? 'Edit deadline' : 'Set deadline',
        ButtonStyle.Primary,
      ),
      this.button(session, 'skip:deadline', 'Skip', ButtonStyle.Secondary),
      this.button(session, 'continue:deadline', 'Continue', ButtonStyle.Success),
      this.button(session, 'back:reward', 'Back', ButtonStyle.Secondary),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  buildPreview(
    session: BountyOnboardingSession,
    warning?: string,
  ): BountyWizardView {
    const draft = session.draft;
    const embed = new EmbedBuilder()
      .setColor(warning ? Colors.Red : Colors.Blurple)
      .setTitle('Draft Preview')
      .setDescription(
        (warning ? `⚠️ ${warning}\n\n` : '') +
          'Review your bounty below. Edit any field, or publish when ready.',
      )
      .addFields(
        { name: 'Title', value: this.draftValue(draft.title) },
        { name: 'Summary', value: this.draftValue(draft.summary) },
        {
          name: 'Repository',
          value: draft.repository
            ? `[${draft.repository}](https://github.com/${draft.repository})`
            : '*Not set*',
          inline: true,
        },
        {
          name: 'Issue',
          value:
            draft.issueUrl && draft.issueNumber
              ? `[#${draft.issueNumber}](${draft.issueUrl})`
              : '*Not set*',
          inline: true,
        },
        {
          name: 'Reward',
          value:
            draft.rewardAmount !== undefined
              ? `**${formatRewardAmount(draft.rewardAmount)} ${draft.currency}**`
              : '*Not set*',
          inline: true,
        },
        {
          name: 'Deadline',
          value: this.formatDeadline(draft.deadline),
          inline: true,
        },
      )
      .setFooter({ text: 'Step 5 of 5 • Not published yet' });

    const editRow = this.row(
      this.button(session, 'edit:title', 'Edit title', ButtonStyle.Secondary),
      this.button(session, 'edit:github', 'Edit GitHub', ButtonStyle.Secondary),
      this.button(session, 'edit:reward', 'Edit reward', ButtonStyle.Secondary),
    );
    const actionRow = this.row(
      this.button(
        session,
        'edit:deadline',
        'Edit deadline',
        ButtonStyle.Secondary,
      ),
      this.button(
        session,
        'publish',
        'Publish',
        ButtonStyle.Success,
        '🚀',
        !isBountyDraftComplete(draft),
      ),
      this.button(session, 'cancel', 'Cancel', ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [editRow, actionRow] };
  }

  buildCancelConfirmation(session: BountyOnboardingSession): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('Cancel this bounty?')
      .setDescription(
        'Your draft will be discarded. This cannot be undone.',
      );

    const row = this.row(
      this.button(
        session,
        'cancel:confirm',
        'Discard draft',
        ButtonStyle.Danger,
      ),
      this.button(session, 'cancel:abort', 'Keep editing', ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  buildCancelled(): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Grey)
      .setTitle('Draft cancelled')
      .setDescription(
        'Your bounty draft was discarded. Run `/create-bounty` to start again.',
      );

    return { embeds: [embed], components: [] };
  }

  buildExpired(): BountyWizardView {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('Session expired')
      .setDescription(
        'This bounty draft timed out after 15 minutes of inactivity. ' +
          'Run `/create-bounty` to start a new one.',
      );

    return { embeds: [embed], components: [] };
  }

  buildPublishedConfirmation(
    session: BountyOnboardingSession,
    postUrl: string,
    channelId: string,
  ): BountyWizardView {
    const draft = session.draft;
    const embed = new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('Bounty published!')
      .setDescription(
        `Your bounty **${draft.title ?? 'Untitled'}** is now live in <#${channelId}>.`,
      )
      .addFields({
        name: 'Reward',
        value:
          draft.rewardAmount !== undefined
            ? `**${formatRewardAmount(draft.rewardAmount)} ${draft.currency}**`
            : '*Not set*',
        inline: true,
      });

    if (draft.issueUrl && draft.issueNumber) {
      embed.addFields({
        name: 'Issue',
        value: `[#${draft.issueNumber}](${draft.issueUrl})`,
        inline: true,
      });
    }

    const buttons: ButtonBuilder[] = [
      new ButtonBuilder()
        .setLabel('View bounty post')
        .setStyle(ButtonStyle.Link)
        .setURL(postUrl),
    ];
    if (draft.issueUrl) {
      buttons.push(
        new ButtonBuilder()
          .setLabel('View issue')
          .setStyle(ButtonStyle.Link)
          .setURL(draft.issueUrl),
      );
    }

    return { embeds: [embed], components: [this.row(...buttons)] };
  }

  buildTitleModal(session: BountyOnboardingSession): ModalBuilder {
    const titleInput = this.textInput({
      id: 'title',
      label: 'Title',
      style: TextInputStyle.Short,
      value: session.draft.title,
      placeholder: 'e.g. Add pagination to the bounty API',
      minLength: TITLE_MIN_LENGTH,
      maxLength: TITLE_MAX_LENGTH,
    });
    const summaryInput = this.textInput({
      id: 'summary',
      label: 'Short summary',
      style: TextInputStyle.Paragraph,
      value: session.draft.summary,
      placeholder: 'What needs to be done, and why does it matter?',
      minLength: SUMMARY_MIN_LENGTH,
      maxLength: SUMMARY_MAX_LENGTH,
    });

    return new ModalBuilder()
      .setCustomId(buildBountyCustomId(session.id, 'modal:title'))
      .setTitle('Bounty title & summary')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(summaryInput),
      );
  }

  buildGithubModal(session: BountyOnboardingSession): ModalBuilder {
    const repositoryInput = this.textInput({
      id: 'repository',
      label: 'Repository (owner/repo)',
      style: TextInputStyle.Short,
      value: session.draft.repository,
      placeholder: 'owner/repo',
      maxLength: 200,
    });
    const issueUrlInput = this.textInput({
      id: 'issue_url',
      label: 'GitHub issue URL',
      style: TextInputStyle.Short,
      value: session.draft.issueUrl,
      placeholder: 'https://github.com/owner/repo/issues/123',
      maxLength: 300,
    });

    return new ModalBuilder()
      .setCustomId(buildBountyCustomId(session.id, 'modal:github'))
      .setTitle('GitHub repository & issue')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(repositoryInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(issueUrlInput),
      );
  }

  buildAmountModal(session: BountyOnboardingSession): ModalBuilder {
    const amountInput = this.textInput({
      id: 'amount',
      label: `Amount (${session.draft.currency})`,
      style: TextInputStyle.Short,
      value:
        session.draft.rewardAmount !== undefined
          ? formatRewardAmount(session.draft.rewardAmount)
          : undefined,
      placeholder: 'e.g. 250',
      maxLength: 32,
    });

    return new ModalBuilder()
      .setCustomId(buildBountyCustomId(session.id, 'modal:amount'))
      .setTitle('Reward amount')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
      );
  }

  buildDeadlineModal(session: BountyOnboardingSession): ModalBuilder {
    const deadlineInput = this.textInput({
      id: 'deadline',
      label: 'Deadline (YYYY-MM-DD, UTC)',
      style: TextInputStyle.Short,
      value: session.draft.deadline
        ? formatDeadlineInput(session.draft.deadline)
        : undefined,
      placeholder: '2026-12-31',
      required: false,
      maxLength: 10,
    });

    return new ModalBuilder()
      .setCustomId(buildBountyCustomId(session.id, 'modal:deadline'))
      .setTitle('Completion deadline')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput),
      );
  }

  private button(
    session: BountyOnboardingSession,
    action: string,
    label: string,
    style: ButtonStyle,
    emoji?: string,
    disabled = false,
  ): ButtonBuilder {
    const button = new ButtonBuilder()
      .setCustomId(buildBountyCustomId(session.id, action))
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);

    if (emoji) button.setEmoji(emoji);
    return button;
  }

  private row(
    ...components: MessageActionRowComponentBuilder[]
  ): ActionRowBuilder<MessageActionRowComponentBuilder> {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      ...components,
    );
  }

  private textInput(options: {
    id: string;
    label: string;
    style: TextInputStyle;
    value?: string;
    placeholder?: string;
    required?: boolean;
    minLength?: number;
    maxLength?: number;
  }): TextInputBuilder {
    const input = new TextInputBuilder()
      .setCustomId(options.id)
      .setLabel(options.label)
      .setStyle(options.style)
      .setRequired(options.required ?? true);

    if (options.value) input.setValue(options.value);
    if (options.placeholder) input.setPlaceholder(options.placeholder);
    if (options.minLength !== undefined) input.setMinLength(options.minLength);
    if (options.maxLength !== undefined) input.setMaxLength(options.maxLength);

    return input;
  }

  private draftValue(value: string | undefined): string {
    return value ?? '*Not set*';
  }

  private formatDeadline(deadline: Date | undefined): string {
    if (!deadline) return '*No deadline*';
    const timestamp = Math.floor(deadline.getTime() / 1000);
    return `<t:${timestamp}:D> (<t:${timestamp}:R>)`;
  }
}
