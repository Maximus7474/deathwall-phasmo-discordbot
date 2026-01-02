import { type ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import type Logger from "../utils/logger";
import { GHOST_TYPES } from "../utils/data";
import { prisma } from "../utils/prisma";

async function handleCreate(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });

    const goal = options.getInteger('goal', true);
    const restrictions = options.getInteger('restrictions', false) ?? 2;

    const inSession = await prisma.session.findFirst({
        where: {
            guild: guildId,
            startedAt: {
                not: null,
            },
            finished: false,
            members: {
                some: {
                    userId: user.id,
                }
            },
        },
        select: {
            id: true,
        },
    });

    if (inSession) {
        return interaction.editReply({
            content: `You're already in an active session on this guild.\n-# session id: \`${inSession.id}\``,
        });
    }

    const session = await prisma.session.create({
        data: {
            guild: guildId,
            successfulRounds: 0,
            goal,
            restrictionsPerRound: restrictions,
        },
    });

    await prisma.sessionMember.create({
        data: {
            userId: user.id,
            isLeader: true,
            sessionId: session.id,
        }
    });
}

async function handleInviteUser(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });
    
    const invitee = options.getUser('user', true);

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            startedAt: null,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                    isLeader: true,
                }
            },
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not leading a session in this guild, you can not invite people to it.`,
        });
    }

    const isListed = await prisma.sessionMember.findFirst({
        where: {
            session: {
                guild: guildId,
            },
            userId: invitee.id,
        },
    });

    if (isListed) {
        return interaction.editReply({
            content: `User ${user.displayName} is already in a session on this guild, he can not be invited to this one.`,
        });
    }

    await prisma.sessionMember.create({
        data: {
            userId: invitee.id,
            isLeader: false,
            sessionId: session.id,
        }
    });

    interaction.editReply({
        content: `User ${user.displayName} was added to the session.`
    });
}

async function handleRemoveUser(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral,
    });
    
    const removee = options.getUser('user', true);

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            startedAt: null,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                    isLeader: true,
                }
            },
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not leading a session in this guild, you can not remove people from one.`,
        });
    }

    const isListed = await prisma.sessionMember.findFirst({
        where: {
            session: {
                guild: guildId,
                id: session.id,
            },
            userId: removee.id,
        },
    });

    if (!isListed) {
        return interaction.editReply({
            content: `User ${user.displayName} is not in your session.`,
        });
    }

    await prisma.sessionMember.delete({
        where: {
            id: isListed.id,
        }
    });

    interaction.editReply({
        content: `User ${user.displayName} was removed from the session.`
    });
}

export default new SlashCommand({
    name: 'session',
    guildSpecific: true,
    hideFromHelp: false,
    slashcommand: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Handle a game sessioon !')
        .addSubcommandGroup(g =>
            g.setName('handle')
            .setDescription('Handle creating, editing sessions')
            .addSubcommand(c =>
                c.setName('create')
                .setDescription('Create a new session')
                .addIntegerOption(o =>
                    o.setName('goal')
                    .setDescription('Number of rounds to win')
                    .setRequired(true)
                    .setMinValue(1)
                )
                .addIntegerOption(o =>
                    o.setName('restrictions')
                    .setDescription('Number of restrictions added per round')
                    .setRequired(false)
                    .setMinValue(1)
                )
            )
            .addSubcommand(c =>
                c.setName('invite')
                .setDescription('Invite a user to the session, will allow him to use commands')
                .addUserOption(o =>
                    o.setName('user')
                    .setDescription('User to invite to the session')
                    .setRequired(true)
                )
            )
            .addSubcommand(c =>
                c.setName('remove')
                .setDescription('Remove a user from the session')
                .addUserOption(o =>
                    o.setName('user')
                    .setDescription('User to remove from the session')
                    .setRequired(true)
                )
            )
            .addSubcommand(c =>
                c.setName('users')
                .setDescription('List the current users of a session')
            )
            .addSubcommand(c =>
                c.setName('start')
                .setDescription('Start a session, no users can be added')
            )
            .addSubcommand(c =>
                c.setName('end')
                .setDescription('Ends a session, will store and archive the results')
            )
        )
        .addSubcommandGroup(g =>
            g.setName('round')
            .setDescription('Handle a round result')
            .addSubcommand(c =>
                c.setName('end')
                .setDescription('Mark the current round as a win')
                .addBooleanOption(o =>
                    o.setName('win')
                    .setDescription('Was the round a victory')
                )
                .addStringOption(o =>
                    o.setName('ghost')
                    .setDescription('The ghost that needed finding')
                    .setAutocomplete(true)
                    .setRequired(true)
                )
            )
            .addSubcommand(c =>
                c.setName('new')
                .setDescription('Start a new round')
            )
            .addSubcommand(c =>
                c.setName('restrictions')
                .setDescription('Show the current restrictions')
            )
        )
        .addSubcommandGroup(g =>
            g.setName('high_scores')
            .setDescription('Show best results and relevant data')
            .addSubcommand(c =>
                c.setName('unavailable')
                .setDescription('unavailable')
            )
        ),
    callback: async (logger, client, interaction) => {
        const command = interaction.options.getSubcommand(),
            commandGroup = interaction.options.getSubcommandGroup() as 'handle' | 'round' | 'high_scores';

        if (commandGroup === 'handle') {
            if (command === 'create') {
                handleCreate(logger, interaction);
                return 
            } else if (command === 'invite') {
                handleInviteUser(logger, interaction);
                return;
            } else if (command === 'remove') {
                handleRemoveUser(logger, interaction);
                return;
            }
        }

        interaction.reply({
            content: `command ${commandGroup} ${command} is not set up`,
        });
    },
    autocomplete: async (logger, client, interaction) => {
        const { options } = interaction;
        const focusedOption = options.getFocused(true);

        if (focusedOption.name === 'ghost') {
            const filtered = GHOST_TYPES
                .filter(ghost =>
                    ghost.toLowerCase().startsWith(focusedOption.value.toLowerCase())
                )
                .slice(0, 25);

            await interaction.respond(
                filtered.map(setting => ({ name: setting, value: setting }))
            );
        }
    },
});