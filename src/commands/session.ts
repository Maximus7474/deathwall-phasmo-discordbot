import { type ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import type Logger from "../utils/logger";
import { prisma } from "../utils/prisma";
import { getCommandLocalization, getGhost, getRestriction, Locale, type LocaleStructure } from "../utils/localeLoader";

const commandId = 'session';
const commandLocales = getCommandLocalization(commandId);

type CleanRestriction = {
    id: string;
    occurences: number | null;
};
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
    const { create: responseLocale } = commandLocales.response;

    if (!guildId) return;

    await interaction.deferReply({});

    const goal = options.getInteger('goal', true);
    const restrictions = options.getInteger('restrictions', false) ?? 2;

    const inSession = await prisma.session.findFirst({
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
        },
    });

    if (inSession) {
        return interaction.editReply({
            content: responseLocale.insession.replace('{session}', inSession.id),
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

    const embed = new EmbedBuilder()
        .setTitle(responseLocale.createdembed.title)
        .setDescription(
            responseLocale.createdembed.content
        )
        .setFooter({
            text: responseLocale.createdembed.footer.replace('{session}', session.id),
        })

    interaction.editReply({
        embeds: [embed],
    });
}

async function handleInviteUser(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;
    const { inviteuser: responseLocale } = commandLocales.response;

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
            content: responseLocale.notlead,
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
            content: responseLocale.userinsession.replace('{username}', invitee.displayName),
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
        content: responseLocale.useradded.replace('{username}', invitee.displayName),
    });
}

async function handleRemoveUser(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;
    const { removeuser: responseLocale } = commandLocales.response;

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
            content: responseLocale.notleading,
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
            content: responseLocale.usernotinsession.replace('{username}', removee.displayName),
        });
    }

    await prisma.sessionMember.delete({
        where: {
            id: isListed.id,
        }
    });

    interaction.editReply({
        content: responseLocale.userremoved.replace('{username}', removee.displayName),
    });
}

async function handleListUsers(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;
    const { listusers: responseLocale, generic: genericResponse } = commandLocales.response;

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
            content: genericResponse.notinsession,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(responseLocale.embed.title)
        .setDescription(
            responseLocale.embed.content
                .replace('{start}', session.startedAt ? `<t:${Math.floor(session.startedAt.getTime() / 1000)}>` : responseLocale.embed.notstarted)
                .replace('{progress}', `${session.successfulRounds}/${session.goal}`)
                .replace('{restrictions}', `${session.restrictionsPerRound}`)
        )
        .setFields({
            name: responseLocale.embed.members,
            value: session.members
                .map(m => 
                    `* ${responseLocale.embed[m.isLeader ? 'lead' : 'member']
                    .replace('{mention}', `<@${m.userId}>`)}`
                )
                .join('\n'),
            inline: true
        });

    await interaction.editReply({
        embeds: [embed],
    });
}

async function handleStartSession(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { user, guildId } = interaction;
    const { startsession: responseLocale, generic: genericResponse } = commandLocales.response;

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
            content: genericResponse.notinsession,
        });
    }

    const roundStarter = await selectRestrictions(session.id, session.restrictionsPerRound);

    if (!roundStarter.success) {
        logger.error(`StartSession, unable to generate restrictions for first round: "${roundStarter.message}"`);

        return interaction.editReply({
            content: `${responseLocale.unabletogenerate}\n> \`${roundStarter.message}\``,
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
        .setTitle(responseLocale.embed.title1)
        .setDescription(
            responseLocale.embed.description1
                .replace('{goal}', `${session.goal}`)
                .replace('{restrictions}', `${session.restrictionsPerRound}`)
        )
        .setFields({
            name: responseLocale.embed.members,
            value: session.members
                .map(m => 
                    `* ${responseLocale.embed[m.isLeader ? 'lead' : 'member']
                    .replace('{mention}', `<@${m.userId}>`)}`
                )
                .join('\n'),
            inline: true
        }),
        //
        new EmbedBuilder()
        .setTitle(responseLocale.embed.title2)
        .setDescription(
            roundStarter.restrictions
            .map(res => {
                const { name, description } = getRestriction(res.id as keyof LocaleStructure['restrictions']);
                
                return `${name}\n`+ (description ? `> ${description}` : '') + '\n'
            })
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
    const { endsession: responseLocale, generic: genericResponse } = commandLocales.response;

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
            content: genericResponse.notinsession,
        });
    }

    const unfinishedSessions = session.rounds
        .some(round => round.won === null && round.finishedAt === null);

    if (unfinishedSessions) {
        return interaction.editReply({
            content: responseLocale.activeround,
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
        .setTitle(responseLocale.embed.title)
        .setColor(projectWin
            ? 'Green'
            : 'Blue'
        )
        .setDescription(
            responseLocale.embed.description
                .replace('{state}', projectWin
                    ? genericResponse.win
                    : genericResponse.loss
                )
                .replace('{wins}', `${roundsWon}`)
                .replace('{losses}', `${roundsLost}`)
        )
        .setFields({
            name: responseLocale.embed.members,
            value: session.members
                .map(m => 
                    `* ${responseLocale.embed[m.isLeader ? 'lead' : 'member']
                    .replace('{mention}', `<@${m.userId}>`)}`
                )
                .join('\n'),
            inline: true
        });
    
    interaction.editReply({
        embeds: [embed],
    });
}

async function handleEndRound(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;
    const { endround: responseLocale, generic: genericResponse } = commandLocales.response;


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
            rounds: true,
            successfulRounds: true,
        },
    });

    if (!session) {
        return interaction.editReply({
            content: genericResponse.notinsession,
        });
    }

    const currentRound = session.rounds
        .find(round => round.won === null && round.finishedAt === null);

    if (!currentRound) {
        return interaction.editReply({
            content: responseLocale.noactiveround,
        });
    }

    const win = options.getBoolean('win', true);
    const ghost = options.getString('ghost', true) as keyof LocaleStructure['ghosts'];

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

    if (win) {
        await prisma.session.update({
            data: {
                successfulRounds: session.successfulRounds + 1,
            },
            where: {
                id: session.id,
            },
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(responseLocale.embed.title)
        .setColor(win
            ? 'DarkGreen'
            : 'DarkRed'
        )
        .setDescription(
            responseLocale.embed.description
                .replace('{state}', genericResponse[win ? 'win' : 'loss'])
                .replace('{ghost}', getGhost(ghost))
        )
        .setFooter({
            text: responseLocale.embed.footer
        });

    interaction.editReply({
        embeds: [embed],
    });
}

async function handleNewRound(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { user, guildId } = interaction;
    const { newround: responseLocale, generic: genericResponse } = commandLocales.response;


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
            content: genericResponse.notinsession,
        });
    }

    const activeRound = session.rounds
        .some(round => round.won === null && round.finishedAt === null);

    if (activeRound) {
        return interaction.editReply({
            content: responseLocale.activeround,
        });
    }

    const roundData = await selectRestrictions(session.id, session.restrictionsPerRound);

    if (!roundData.success) {
        return interaction.editReply({
            content: `${responseLocale.unabletogenerate}\n> \`${roundData.message}\``,
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
        .setTitle(responseLocale.embed.title)
        .setDescription(
            responseLocale.embed.description + '\n'+
            roundData.restrictions
            .map((res) => {
                const { name, description } = getRestriction(res.id as keyof LocaleStructure['restrictions']);
                
                return `${name}\n`+ (description ? `> ${description}` : '') + '\n'
            })
            .join('\n')
        );

    await interaction.editReply({
        embeds: [embed],
    });
}

async function handleRestrictions(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { user, guildId } = interaction;
    const { restrictions: responseLocale, generic: genericResponse } = commandLocales.response;

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
            restrictions: {
                select: {
                    restriction: {
                        select: {
                            id: true,
                        },
                    },
                },
            },
        },
    });

    if (!session) {
        return interaction.editReply({
            content: genericResponse.notinsession,
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(responseLocale.restrictions)
        .setDescription(
            session.restrictions
            .map(({ restriction }) => {
                const { name, description } = getRestriction(restriction.id as keyof LocaleStructure['restrictions']);
                
                return `${name}\n`+ (description ? `> ${description}` : '') + '\n'
            })
            .join('\n')
        );

    interaction.editReply({
        embeds: [embed],
    });
}

const {
    handle: handleSubCommand,
    round: roundSubCommand,
    high_scores: highScoreSubCommand,
} = commandLocales.subcommandGroups;
export default new SlashCommand({
    name: commandId,
    guildSpecific: false,
    hideFromHelp: false,
    slashcommand: new SlashCommandBuilder()
        .setName(commandLocales.name)
        .setDescription(commandLocales.description)
        .addSubcommandGroup(g =>
            g.setName(handleSubCommand.name)
                .setDescription(handleSubCommand.description)
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.create.name)
                        .setDescription(handleSubCommand.subcommands.create.description)
                        .addIntegerOption(o =>
                            o.setName(handleSubCommand.subcommands.create.options.goal.name)
                                .setDescription(handleSubCommand.subcommands.create.options.goal.description)
                                .setRequired(true)
                                .setMinValue(1)
                        )
                        .addIntegerOption(o =>
                            o.setName(handleSubCommand.subcommands.create.options.restrictions.name)
                                .setDescription(handleSubCommand.subcommands.create.options.restrictions.description)
                                .setRequired(false)
                                .setMinValue(1)
                        )
                )
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.invite.name)
                        .setDescription(handleSubCommand.subcommands.invite.description)
                        .addUserOption(o =>
                            o.setName(handleSubCommand.subcommands.invite.options.user.name)
                                .setDescription(handleSubCommand.subcommands.invite.options.user.description)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.remove.name)
                        .setDescription(handleSubCommand.subcommands.remove.description)
                        .addUserOption(o =>
                            o.setName(handleSubCommand.subcommands.remove.options.user.name)
                                .setDescription(handleSubCommand.subcommands.remove.options.user.description)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.users.name)
                        .setDescription(handleSubCommand.subcommands.users.description)
                        .addBooleanOption(o =>
                            o.setName(handleSubCommand.subcommands.users.options.ephemeral.name)
                                .setDescription(handleSubCommand.subcommands.users.options.ephemeral.description)
                                .setRequired(false)
                        )
                )
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.start.name)
                        .setDescription(handleSubCommand.subcommands.start.description)
                )
                .addSubcommand(c =>
                    c.setName(handleSubCommand.subcommands.end.name)
                        .setDescription(handleSubCommand.subcommands.end.description)
                )
        )
        .addSubcommandGroup(g =>
            g.setName(roundSubCommand.name)
                .setDescription(roundSubCommand.description)
                .addSubcommand(c =>
                    c.setName(roundSubCommand.subcommands.end.name)
                        .setDescription(roundSubCommand.subcommands.end.description)
                        .addBooleanOption(o =>
                            o.setName(roundSubCommand.subcommands.end.options.win.name)
                                .setDescription(roundSubCommand.subcommands.end.options.win.description)
                                .setRequired(true)
                        )
                        .addStringOption(o =>
                            o.setName(roundSubCommand.subcommands.end.options.ghost.name)
                                .setDescription(roundSubCommand.subcommands.end.options.ghost.description)
                                .setAutocomplete(true)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName(roundSubCommand.subcommands.new.name)
                        .setDescription(roundSubCommand.subcommands.new.description)
                )
                .addSubcommand(c =>
                    c.setName(roundSubCommand.subcommands.restrictions.name)
                        .setDescription(roundSubCommand.subcommands.restrictions.description)
                )
        )
        .addSubcommandGroup(g =>
            g.setName(highScoreSubCommand.name)
                .setDescription(highScoreSubCommand.description)
                .addSubcommand(c =>
                    c.setName(highScoreSubCommand.subcommands.unavailable.name)
                        .setDescription(highScoreSubCommand.subcommands.unavailable.description)
                )
        ),
    callback: async (logger, client, interaction) => {
        const command = interaction.options.getSubcommand(),
            commandGroup = interaction.options.getSubcommandGroup() as 'handle' | 'round' | 'high_scores';

        if (!interaction.inGuild()) {
            await interaction.reply({
                content: Locale.generic_responses.not_in_guild,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

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
                return;
            }
        } else if (commandGroup === 'round') {
            if (command === 'end') {
                handleEndRound(logger, interaction);
                return;
            } else if (command === 'new') {
                handleNewRound(logger, interaction);
                return;
            } else if (command === 'restrictions') {
                handleRestrictions(logger, interaction);
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
            const ghosts = getGhost();
            const searchTerm = focusedOption.value.toLowerCase();

            const filtered = Object.entries(ghosts)
                .filter(([key, label]) => {
                    return key.toLowerCase().includes(searchTerm) || 
                        label.toLowerCase().includes(searchTerm);
                })
                .slice(0, 25);

            await interaction.respond(
                filtered.map(([key, label]) => ({ 
                    name: label,
                    value: key
                }))
            );
        }
    },
});