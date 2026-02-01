import { AttachmentBuilder, type ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import type Logger from "../utils/logger";
import { prisma } from "../utils/prisma";
import { getCommandLocalization, getGhost, getRestriction, Locale, localeKey, type LocaleStructure } from "../utils/localeLoader";
import type { GhostType } from "@types";
import { GAME_ITEMS, GHOST_TYPES } from "../utils/data";
import { drawRestrictionRecap, GameSettings } from "../utils/restrictionImage";
import { shuffleArray } from "../utils/utils";

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

// helper functions

async function initializeRound(sessionId: string, restrictionCount: number, sessionMember: string): Promise<ResSelectionResponse> {
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

    const weightedPool = shuffleArray(restrictions.map(res => {
        const stats = restrictionStats[res.id] || { count: 0 };
        
        const weight = Math.max(0, (res.occurences ?? 1) - stats.count);
        
        return {
            id: res.id,
            weight
        };
    })
    .filter(res => res.weight > 0));

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

    const restrictionTemplates = await prisma.restriction.findMany({
        where: { id: { in: selectedIds } }
    });

    const newRound = await prisma.sessionRound.create({
        data: {
            sessionId: sessionId,
            startedById: sessionMember,
        },
    });

    const sessionRestrictionsData = restrictionTemplates.map(template => {
        const instanceMetadata = template.metadata ? JSON.parse(JSON.stringify(template.metadata)) : {};

        if (typeof instanceMetadata.forgottenItem === 'number') {
            const randomItem = GAME_ITEMS[Math.floor(Math.random() * GAME_ITEMS.length)];

            if (instanceMetadata.forgottenItem) instanceMetadata.forgottenItem = randomItem;
        }

        return {
            sessionId: sessionId,
            restrictionId: template.id,
            metadata: instanceMetadata,
            roundId: newRound.id,
        };
    });

    await prisma.sessionRestriction.createMany({
        data: sessionRestrictionsData,
    });

    const newRestrictions = restrictions.filter(res => selectedIds.includes(res.id));

    return {
        success: true,
        restrictions: newRestrictions,
    };
}

const baseValues = {
    modifiers: {
        evidence: 3,
        tier: 3,
        entitySpeed: 100,
        playerSpeed: 100,
        breaker: true,
        sanity: 100,
        sprint: true,
    }
}
async function getGlobalRecap(sessionId: string) {
    const activeRestrictions = await prisma.sessionRestriction.findMany({
        where: { 
            sessionId: sessionId,
        },
    });

    const result: GameSettings = {
        modifiers: JSON.parse(JSON.stringify(baseValues.modifiers)) as GameSettings['modifiers'],
        removedItems: [] as string[],
    };

    activeRestrictions.forEach((res) => {
        const meta = res.metadata as Record<string, number | boolean | string> | null;
        if (!meta) return;

        for (const [key, value] of Object.entries(meta)) {
            if (key in result.modifiers) {
                const modKey = key as keyof GameSettings['modifiers'];

                if (typeof value === 'number' && typeof result.modifiers[modKey] === 'number') {
                    (result.modifiers[modKey] as number) += value;
                } 
                else if (typeof value === 'boolean') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (result.modifiers[modKey] as any) = value;
                }
            } 
            // 3. Handle removed items
            else if (typeof value === 'string' && ['item', 'forgottenItem', 'soleItem'].includes(key)) {
                result.removedItems.push(value);
            }
        }
    });

    return result;
}

type EndRoundResponse = {
    finished: false;
} | {
    finished: true;
    win: boolean;
    embed: EmbedBuilder;
};

async function calculateSessionScore(sessionId: string) {
    const session = await prisma.session.findUnique({
        where: { id: sessionId },
        include: {
            rounds: { orderBy: { startedAt: 'asc' }, include: { restrictions: true } },
            restrictions: { include: { restriction: true } }
        }
    });

    if (!session) throw new Error("Session not found");

    const restrictionScore = session.rounds.reduce((sum, round) => {
        const roundRestristions = round.restrictions;

        if (!round.won) return sum;
        
        let score = 0;
        for (const restriction of roundRestristions) {
            const resData = session.restrictions.find(e => e.id === restriction.id)!;

            score += resData.restriction.score;
        }

        return sum + score;
    }, 0);

    // equivalent to professional multiplier
    // allowing for future changes allowing difficulty selection
    const DIFFICULTY_MULTIPLIYER = 3;
    const BASE_POINTS_PER_WIN = 2;
    
    let roundPoints = 0;
    let successfulCount = 0;

    for (const round of session.rounds) {
        if (round.won === true) {
            roundPoints += BASE_POINTS_PER_WIN;
            successfulCount++;
        }
    }
    
    const isGoalReached = successfulCount >= session.goal;
    // Debattable if we reduce the gap between a successful session and a loss
    const completionMultiplier = isGoalReached ? 2.0 : 1.0;

    const totalRoundsPlayed = session.rounds.length || 1;
    const efficiencyRate = successfulCount / totalRoundsPlayed;

    // Final Calculation
    const finalScore = (roundPoints * completionMultiplier + restrictionScore * DIFFICULTY_MULTIPLIYER) * efficiencyRate;

    const updatedSession = await prisma.session.update({
        where: { id: sessionId },
        data: {
            score: Math.round(finalScore),
            successfulRounds: successfulCount,
            finished: true,
            finishedAt: new Date()
        }
    });

    return {
        finalScore: updatedSession.score,
        successfulRounds: updatedSession.successfulRounds,
        totalRounds: totalRoundsPlayed,
        goalReached: isGoalReached
    };
}

async function checkEndCondition(sessionId: string): Promise<EndRoundResponse> {
    const { endsession: responseLocale, generic: genericResponse } = commandLocales.response;

    const session = (await prisma.session.findFirst({
        where: {
            id: sessionId,
        },
        select: {
            id: true,
            goal: true,
            members: true,
            rounds: true,
        },
    }))!;
    
    const roundsWon = session.rounds.filter(r => r.won).length;

    if (roundsWon < session.goal && roundsWon === session.rounds.length) return { finished: false };

    const scoring = await calculateSessionScore(sessionId);

    const sessionWin = scoring.goalReached;

    const embed = new EmbedBuilder()
        .setTitle(responseLocale.embed.title)
        .setColor(sessionWin
            ? 'Green'
            : 'Blue'
        )
        .setDescription(
            responseLocale.embed.description
                .replace('{state}', sessionWin
                    ? genericResponse.win
                    : genericResponse.loss
                )
                .replace('{score}', `${scoring.finalScore}`)
                .replace('{successfulrounds}', `${scoring.successfulRounds}`)
                .replace('{totalrounds}', `${scoring.totalRounds}`)
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

    await prisma.session.update({
        data: {
            finished: true,
            finishedAt: new Date(),
        },
        where: {
            id: session.id,
        }
    });
    
    return {
        finished: true,
        win: sessionWin,
        embed,
    };
}

// callback handlers

async function handleCreate(logger: Logger, interaction: ChatInputCommandInteraction) {
    const { options, user, guildId } = interaction;
    const { create: responseLocale } = commandLocales.response;

    if (!guildId) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
                finished: false,
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
    const ghostInput = options.getString('ghost', true);

    if (!GHOST_TYPES.includes(ghostInput as GhostType)) {
        return interaction.editReply({
            content: responseLocale.invalidghost,
        });
    }

    const ghost = ghostInput as GhostType;

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

    const endCondition = await checkEndCondition(session.id);

    let embed: EmbedBuilder;

    if (endCondition.finished) {
        embed = endCondition.embed;
    } else {
        embed = new EmbedBuilder()
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
    }

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
            startedAt: true,
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

    const sessionMember = session.members.find(member => member.userId === user.id)!;

    const roundData = await initializeRound(session.id, session.restrictionsPerRound, sessionMember.id);

    if (!roundData.success) {
        return interaction.editReply({
            content: `${responseLocale.unabletogenerate}\n> \`${roundData.message}\``,
        });
    }

    if (!session.startedAt) {
        await prisma.session.update({
            where: {
                id: session.id,
            },
            data: {
                startedAt: new Date(),
            }
        });
    }

    const restrictions = await getGlobalRecap(session.id);
    const buffer = await drawRestrictionRecap(restrictions as GameSettings);
    const attachment = new AttachmentBuilder(buffer, { name: 'recap.png' });

    const embeds = [new EmbedBuilder()
        .setTitle(responseLocale.embed.title)
        .setDescription(
            responseLocale.embed.description + '\n'+
            roundData.restrictions
            .map((res) => {
                const { name, description } = getRestriction(res.id as keyof LocaleStructure['restrictions']);
                
                return `${name}\n`+ (description ? `> ${description}` : '') + '\n'
            })
            .join('\n')
        ),
        new EmbedBuilder()
        // .setDescription(`\`\`\`json\n${JSON.stringify(await getGlobalRecap(session.id), null, 4)}\n\`\`\``)
        .setImage('attachment://recap.png')
    ];

    await interaction.editReply({
        embeds,
        files: [attachment],
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

    const restrictions = await getGlobalRecap(session.id);
    const buffer = await drawRestrictionRecap(restrictions as GameSettings);
    const attachment = new AttachmentBuilder(buffer, { name: 'recap.png' });

    const embeds = [
        new EmbedBuilder()
        .setTitle(responseLocale.restrictions)
        .setDescription(
            session.restrictions
            .map(({ restriction }) => {
                const { name, description } = getRestriction(restriction.id as keyof LocaleStructure['restrictions']);
                
                return `${name}\n`+ (description ? `> ${description}` : '') + '\n'
            })
            .join('\n')
        ),
        new EmbedBuilder()
        // .setDescription(`\`\`\`json\n${JSON.stringify(restrictions, null, 4)}\n\`\`\``)
        .setImage('attachment://recap.png')
    ];

    interaction.editReply({
        embeds,
        files: [attachment],
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
    .setName('session')
    .setNameLocalization(localeKey, commandLocales.name)
    .setDescription('Handle a game session')
    .setDescriptionLocalization(localeKey, commandLocales.description)
        // handle
        .addSubcommandGroup(g =>
            g.setName('handle')
                .setNameLocalization(localeKey, handleSubCommand.name)
                .setDescription('Handle creating, editing sessions')
                .setDescriptionLocalization(localeKey, handleSubCommand.description)
                
                .addSubcommand(c =>
                    c.setName('create')
                        .setNameLocalization(localeKey, handleSubCommand.subcommands.create.name)
                        .setDescription('Create a new session')
                        .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.create.description)
                        .addIntegerOption(o =>
                            o.setName('goal')
                                .setNameLocalization(localeKey, handleSubCommand.subcommands.create.options.goal.name)
                                .setDescription('Number of rounds to win')
                                .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.create.options.goal.description)
                                .setRequired(true)
                                .setMinValue(1)
                        )
                        .addIntegerOption(o =>
                            o.setName('restrictions')
                                .setNameLocalization(localeKey, handleSubCommand.subcommands.create.options.restrictions.name)
                                .setDescription('Number of restrictions added per round')
                                .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.create.options.restrictions.description)
                                .setRequired(false)
                                .setMinValue(1)
                        )
                )
                .addSubcommand(c =>
                    c.setName('invite')
                        .setNameLocalization(localeKey, handleSubCommand.subcommands.invite.name)
                        .setDescription('Invite a user to the session')
                        .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.invite.description)
                        .addUserOption(o =>
                            o.setName('user')
                                .setNameLocalization(localeKey, handleSubCommand.subcommands.invite.options.user.name)
                                .setDescription('User to invite to the session')
                                .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.invite.options.user.description)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName('remove')
                        .setNameLocalization(localeKey, handleSubCommand.subcommands.remove.name)
                        .setDescription('Remove a user from the session')
                        .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.remove.description)
                        .addUserOption(o =>
                            o.setName('user')
                                .setNameLocalization(localeKey, handleSubCommand.subcommands.remove.options.user.name)
                                .setDescription('User to remove from the session')
                                .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.remove.options.user.description)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName('users')
                        .setNameLocalization(localeKey, handleSubCommand.subcommands.users.name)
                        .setDescription('List the current users of a session')
                        .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.users.description)
                        .addBooleanOption(o =>
                            o.setName('ephemeral')
                                .setNameLocalization(localeKey, handleSubCommand.subcommands.users.options.ephemeral.name)
                                .setDescription('Show the list to all users in a channel')
                                .setDescriptionLocalization(localeKey, handleSubCommand.subcommands.users.options.ephemeral.description)
                                .setRequired(false)
                        )
                )
        )

        // round
        .addSubcommandGroup(g =>
            g.setName('round')
                .setNameLocalization(localeKey, roundSubCommand.name)
                .setDescription('Handle a round result')
                .setDescriptionLocalization(localeKey, roundSubCommand.description)
                
                .addSubcommand(c =>
                    c.setName('end')
                        .setNameLocalization(localeKey, roundSubCommand.subcommands.end.name)
                        .setDescription('Mark the current round as a win')
                        .setDescriptionLocalization(localeKey, roundSubCommand.subcommands.end.description)
                        .addBooleanOption(o =>
                            o.setName('win')
                                .setNameLocalization(localeKey, roundSubCommand.subcommands.end.options.win.name)
                                .setDescription('Was the round a victory')
                                .setDescriptionLocalization(localeKey, roundSubCommand.subcommands.end.options.win.description)
                                .setRequired(true)
                        )
                        .addStringOption(o =>
                            o.setName('ghost')
                                .setNameLocalization(localeKey, roundSubCommand.subcommands.end.options.ghost.name)
                                .setDescription('The ghost that needed finding')
                                .setDescriptionLocalization(localeKey, roundSubCommand.subcommands.end.options.ghost.description)
                                .setAutocomplete(true)
                                .setRequired(true)
                        )
                )
                .addSubcommand(c =>
                    c.setName('new')
                        .setNameLocalization(localeKey, roundSubCommand.subcommands.new.name)
                        .setDescription('Start a new round')
                        .setDescriptionLocalization(localeKey, roundSubCommand.subcommands.new.description)
                )
                .addSubcommand(c =>
                    c.setName('restrictions')
                        .setNameLocalization(localeKey, roundSubCommand.subcommands.restrictions.name)
                        .setDescription('Show the current restrictions')
                        .setDescriptionLocalization(localeKey, roundSubCommand.subcommands.restrictions.description)
                )
        )

        // high scores
        .addSubcommandGroup(g =>
            g.setName('high_scores')
                .setNameLocalization(localeKey, highScoreSubCommand.name)
                .setDescription('Show best results and relevant data')
                .setDescriptionLocalization(localeKey, highScoreSubCommand.description)
                
                .addSubcommand(c =>
                    c.setName('unavailable')
                        .setNameLocalization(localeKey, highScoreSubCommand.subcommands.unavailable.name)
                        .setDescription('Section currently unavailable')
                        .setDescriptionLocalization(localeKey, highScoreSubCommand.subcommands.unavailable.description)
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
