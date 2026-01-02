import { MessageFlags, SlashCommandBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import { GHOST_TYPES } from "../utils/data";

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
            g.setName('high scores')
            .setDescription('Show best results and relevant data')
            .addSubcommand(c =>
                c.setName('unavailable')
                .setDescription('unavailable')
            )
        ),
    callback: async (logger, client, interaction) => {
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