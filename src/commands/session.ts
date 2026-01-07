import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import type { Restriction } from '@prisma/client'
import SlashCommand from "../classes/slash_command";
import type Logger from "../utils/logger";
import { GHOST_TYPES } from "../utils/data";
import { prisma } from "../utils/prisma";

type CleanRestriction = Omit<Restriction, 'addedBy' | 'addedAt'>;
type ResSelectionResponse = {
    success: false;
    message: string;
} | {
    success: true;
    restrictions: CleanRestriction[];
}

async function selectRestrictions(sessionId: string, restrictionCount: number): Promise<ResSelectionResponse> {
    const rawCurrentRestrictions = await prisma.sessionRestriction.findMany({
        where: {
            sessionId,
        },
        select: {
            restriction: {
                select: {
                    id: true,
                    occurences: true,
                }
            }
        }
    });

    const unselectableRestrictions: string[] = [];
    const restrictionStats = rawCurrentRestrictions
        .reduce<{ [key: string ]: { count: number; maxOccurrences: number }}>(
            (acc, { restriction }) => {
                const id = restriction.id;
                
                if (!acc[id]) {
                    acc[id] = {
                        count: 0,
                        maxOccurrences: restriction.occurences || Infinity
                    };
                }
                acc[id].count++;

                if (acc[id].count >= acc[id].maxOccurrences) {
                    unselectableRestrictions.push(id);
                }

                return acc;
            }, {}
        );

    const restrictions = await prisma.restriction.findMany({
        where: {
            id: {
                notIn: unselectableRestrictions
            },
        },
        select: {
            id: true,
            occurences: true,
            title: true,
            description: true,
            addedAt: false,
            addedBy: false,
        }
    });

    if (restrictions.length < 1) return {
        success: false,
        message: 'No restrictions found !',
    };

    const weightedPool = restrictions.map(res => {
        const stats = restrictionStats[res.id] || { count: 0 };
        
        const weight = Math.max(0, (res.occurences ?? Infinity) - stats.count);
        
        return {
            id: res.id,
            weight
        };
    }).filter(res => res.weight > 0);

    if (weightedPool.length === 0) return {
        success: false,
        message: 'No new restrictions can be added !',
    };

    const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0);

    const selectedIds: string[] = [];

    for (let i = 0; i < restrictionCount; i++) {
        let roll = Math.random() * totalWeight;
        
        for (const item of weightedPool) {
            roll -= item.weight;
            if (roll <= 0 && !selectedIds.includes(item.id)) {
                selectedIds.push(item.id);
                break;
            }
        }
    }

    const roundCount = await prisma.sessionRound.count({
        where: {
            sessionId,
        },
    });

    await prisma.sessionRestriction.createMany({
        data: selectedIds.map(id => ({
            number: roundCount + 1,
            sessionId: sessionId,
            restrictionId: id,
        })),
    });

    const newRestrictions = restrictions.filter(res => selectedIds.includes(res.id));

    return {
        success: true,
        restrictions: newRestrictions,
    };
}

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

async function handleListUsers(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;

    if (!guildId) return;

    const ephemeral = options.getBoolean('ephemeral', false) ?? false;

    await interaction.deferReply({
        flags: ephemeral
            ? MessageFlags.Ephemeral
            : [],
    });

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                }
            },
        },
        select: {
            members: true,
            id: true,
            startedAt: true,
            goal: true,
            successfulRounds: true,
            restrictionsPerRound: true,
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not in a session in this guild.`,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('Session members')
        .setDescription(
            `Start: ${session.startedAt ? `<t:${Math.floor(session.startedAt.getTime() / 1000)}>` : 'not started'}\n`+
            `Progress: ${session.successfulRounds}/${session.goal}\n`+
            `New restrictions per round: ${session.restrictionsPerRound}`
        )
        .setFields({
            name: 'Members',
            value: session.members
                .map(m => `* ${m.isLeader ? ':cook:' : ''}<@${m.userId}>`)
                .join('\n'),
            inline: true
        });

    await interaction.editReply({
        embeds: [embed],
    });
}

async function handleStartSession(logger: Logger, interaction: ChatInputCommandInteraction) {
    
    const { user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({});

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                    isLeader: true,
                }
            },
        },
        select: {
            members: true,
            id: true,
            startedAt: true,
            goal: true,
            successfulRounds: true,
            restrictionsPerRound: true,
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not in a session in this guild.`,
        });
    }

    const roundStarter = await selectRestrictions(session.id, session.restrictionsPerRound);

    if (!roundStarter.success) {
        return interaction.editReply({
            content: `Unable to generate restrictions for first round:\n> \`${roundStarter.message}\``,
        });
    }

    const sessionMember = session.members.find(member => member.userId === user.id)!;

    await prisma.sessionRound.create({
        data: {
            sessionId: session.id,
            startedById: sessionMember.id,
        },
    });

    const embeds = [
        // header embed
        new EmbedBuilder()
        .setTitle('Session started')
        .setDescription(
            `Goal: ${session.goal}\n`+
            `New restrictions per round: ${session.restrictionsPerRound}`
        )
        .setFields({
            name: 'Members',
            value: session.members
                .map(m => `* ${m.isLeader ? ':cook:' : ''}<@${m.userId}>`)
                .join('\n'),
            inline: true
        }),
        //
        new EmbedBuilder()
        .setTitle('First Restrictions')
        .setDescription(
            roundStarter.restrictions
            .map(res => `* ${res.title}\n`+
                (res.description ? `> ${res.description}` : '') + '\n'
            )
            .join('\n')
        )
    ];

    await interaction.editReply({
        content: session.members
            .map(({ userId }) => `<@${userId}>`)
            .join(' '),
        embeds,
    });
}

async function handleEndSession(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({});

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                    isLeader: true,
                }
            },
        },
        select: {
            id: true,
            goal: true,
            members: true,
            rounds: true,
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not in a session in this guild.`,
        });
    }

    const unfinishedSessions = session.rounds
        .some(round => round.won === null && round.finishedAt === null);

    if (unfinishedSessions) {
        return interaction.editReply({
            content: `You have an active round, use \`/session round end\` to determine the final outcome of it.`,
        });
    }

    await prisma.session.update({
        data: {
            finished: true,
            finishedAt: new Date(),
        },
        where: {
            id: session.id,
        }
    });

    const roundsWon = session.rounds.filter(round => round.won).length;
    const roundsLost = session.rounds.length - roundsWon;
    const projectWin = roundsWon >= session.goal;

    const embed = new EmbedBuilder()
        .setTitle('Session has ended')
        .setColor(projectWin
            ? 'Green'
            : 'Blue'
        )
        .setDescription(
            `This session concluded in a ${projectWin ? 'win' : 'loss'}.\n`+
            `Score: ${roundsWon} wins - ${roundsLost} losses`
        )
        .setFields({
            name: 'Members',
            value: session.members
                .map(m => `* ${m.isLeader ? ':cook:' : ''}<@${m.userId}>`)
                .join('\n'),
            inline: true
        });
    
    interaction.editReply({
        embeds: [embed],
    });
}

async function handleEndRound(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({});

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                }
            },
        },
        select: {
            rounds: true,
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not in a session in this guild.`,
        });
    }

    const currentRound = session.rounds
        .find(round => round.won === null && round.finishedAt === null);

    if (!currentRound) {
        return interaction.editReply({
            content: `You don't have an active round, use \`/session round start\` to start a new round.`,
        });
    }

    const win = options.getBoolean('win', true);
    const ghost = options.getString('ghost', true);

    await prisma.sessionRound.update({
        data: {
            won: win,
            ghostType: ghost,
            finishedAt: new Date(),
        },
        where: {
            id: currentRound.id,
        },
    });

    const embed = new EmbedBuilder()
        .setTitle('Round finished')
        .setColor(win
            ? 'DarkGreen'
            : 'DarkRed'
        )
        .setDescription(
            `Round resulted in a ${win ? 'win' : 'loss'}\n`+
            `Ghost type: ${ghost}`,
        )
        .setFooter({
            text: 'To start a new round use /round start'
        });

    interaction.editReply({
        embeds: [embed],
    });
}

async function handleNewRound(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { user, guildId } = interaction;

    if (!guildId) return;

    await interaction.deferReply({});

    const session = await prisma.session.findFirst({
        where: {
            guild: guildId,
            finished: false,
            members: {
                some: {
                    userId: user.id,
                }
            },
        },
        select: {
            id: true,
            restrictionsPerRound: true,
            rounds: true,
            members: {
                select: {
                    id: true,
                    userId: true,
                },
            },
        },
    });

    if (!session) {
        return interaction.editReply({
            content: `You're not in a session in this guild.`,
        });
    }

    const activeRound = session.rounds
        .some(round => round.won === null && round.finishedAt === null);

    if (activeRound) {
        return interaction.editReply({
            content: `You still have an active round, use \`/session round end\` to start a end round it and provide results.`,
        });
    }

    const roundData = await selectRestrictions(session.id, session.restrictionsPerRound);

    if (!roundData.success) {
        return interaction.editReply({
            content: `Unable to generate restrictions for first round:\n> \`${roundData.message}\``,
        });
    }

    const sessionMember = session.members.find(member => member.userId === user.id)!;

    await prisma.sessionRound.create({
        data: {
            sessionId: session.id,
            startedById: sessionMember.id,
        },
    });

    const embed = new EmbedBuilder()
        .setTitle('First Restrictions')
        .setDescription(
            'New restrictions:\n'+
            roundData.restrictions
            .map(res => `* ${res.title}\n`+
                (res.description ? `> ${res.description}` : '') + '\n'
            )
            .join('\n')
        );

    await interaction.editReply({
        embeds: [embed],
    });
}

async function handleRestrictions(logger: Logger, interaction: ChatInputCommandInteraction) {
    
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
                .addBooleanOption(o =>
                    o.setName('ephemeral')
                    .setDescription('Show the list to all users in a channel (default: True)')
                    .setRequired(false)
                )
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
            } else if (command === 'users') {
                handleListUsers(logger, interaction);
                return;
            }  else if (command === 'start') {
                handleStartSession(logger, interaction);
                return;
            } else if (command === 'end') {
                handleEndSession(logger, interaction);
            }
        } else if (commandGroup === 'round') {
            if (command === 'end') {
                handleEndRound(logger, interaction);
            } else if (command === 'start') {
                handleNewRound(logger, interaction);
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