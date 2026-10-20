import { Injectable, Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Colors,
  EmbedBuilder,
  Guild,
  PermissionFlagsBits,
} from 'discord.js';
import type { GuildBasedChannel } from 'discord.js';
import { BountyOnboardingSession } from './bounty-onboarding.service';
import { formatRewardAmount } from '../utils/bounty-validation';

export class BountyPublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BountyPublishError';
  }
}

export interface PublishedBounty {
  messageId: string;
  channelId: string;
  url: string;
}

@Injectable()
export class BountyPublicationService {
  private readonly logger = new Logger(BountyPublicationService.name);

  async publish(
    session: BountyOnboardingSession,
    client: Client,
    guild: Guild | null,
  ): Promise<PublishedBounty> {
    const {
      title,
      summary,
      repository,
      issueUrl,
      issueNumber,
      rewardAmount,
      currency,
      deadline,
    } = session.draft;

    if (
      !title ||
      !summary ||
      !repository ||
      !issueUrl ||
      issueNumber === undefined ||
      rewardAmount === undefined
    ) {
      throw new BountyPublishError(
        'This draft is incomplete. Edit the missing fields and try again.',
      );
    }

    const channelId =
      process.env.DISCORD_BOUNTIES_CHANNEL_ID ??
      process.env.DISCORD_BOUNTY_CHANNEL_ID;
    if (!channelId) {
      throw new BountyPublishError(
        'The bounty channel is not configured. Ask an admin to set `DISCORD_BOUNTIES_CHANNEL_ID`.',
      );
    }

    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (err) {
      this.logger.warn(
        `[create-bounty] Could not fetch bounty channel ${channelId}: ${err}`,
      );
      throw new BountyPublishError(
        'I could not access the configured bounty channel. Check the channel ID and the bot permissions.',
      );
    }

    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      throw new BountyPublishError(
        'The configured bounty channel is not a text channel.',
      );
    }
    if (!channel.isSendable()) {
      throw new BountyPublishError(
        'I cannot send messages in the configured bounty channel.',
      );
    }

    await this.assertChannelPermissions(channel, guild);

    const embed = this.buildBountyEmbed(session);
    const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View issue')
        .setStyle(ButtonStyle.Link)
        .setURL(issueUrl),
    );

    let message;
    try {
      message = await channel.send({
        embeds: [embed],
        components: [linkRow],
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      this.logger.error(
        `[create-bounty] Failed to publish session ${session.id}: ${err}`,
      );
      throw new BountyPublishError(
        'Discord rejected the post. Check the bot permissions in the bounty channel and try again.',
      );
    }

    const url = `https://discord.com/channels/${guild?.id ?? '@me'}/${channel.id}/${message.id}`;
    this.logger.log(
      `[create-bounty] Published session ${session.id} to channel ${channel.id} as message ${message.id}`,
    );

    return { messageId: message.id, channelId: channel.id, url };
  }

  private async assertChannelPermissions(
    channel: GuildBasedChannel,
    guild: Guild | null,
  ): Promise<void> {
    if (!guild) return;

    let me = guild.members.me;
    if (!me) {
      try {
        me = await guild.members.fetchMe();
      } catch {
        return;
      }
    }

    const permissions = channel.permissionsFor(me);
    if (!permissions) return;

    const required = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
    ];
    const missing = required.filter((permission) => !permissions.has(permission));
    if (missing.length > 0) {
      throw new BountyPublishError(
        'I do not have permission to post in the bounty channel. Ask an admin to grant **View Channel**, **Send Messages**, and **Embed Links**.',
      );
    }
  }

  private buildBountyEmbed(session: BountyOnboardingSession): EmbedBuilder {
    const draft = session.draft;
    const deadline = draft.deadline
      ? `<t:${Math.floor(draft.deadline.getTime() / 1000)}:D> (<t:${Math.floor(
          draft.deadline.getTime() / 1000,
        )}:R>)`
      : 'No deadline';

    return new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle(`🎯 ${draft.title ?? 'Untitled bounty'}`)
      .setDescription(draft.summary ?? '')
      .addFields(
        {
          name: 'Repository',
          value: `[${draft.repository}](https://github.com/${draft.repository})`,
          inline: true,
        },
        {
          name: 'Issue',
          value: `[#${draft.issueNumber}](${draft.issueUrl})`,
          inline: true,
        },
        {
          name: 'Reward',
          value: `**${formatRewardAmount(draft.rewardAmount!)} ${draft.currency}**`,
          inline: true,
        },
        { name: 'Deadline', value: deadline, inline: true },
        { name: 'Posted by', value: `<@${session.userId}>`, inline: true },
      )
      .setFooter({ text: 'DevLoot • Create your own bounty with /create-bounty' })
      .setTimestamp();
  }
}
