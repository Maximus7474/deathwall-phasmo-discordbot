import { MessageFlags, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import { getCommandLocalization, Locale, localeKey } from "../utils/localeLoader";

const commandId = 'help';
const commandLocales = getCommandLocalization(commandId);

export default new SlashCommand({
    name: commandId,
    guildSpecific: false,
    hideFromHelp: true,
    slashcommand: new SlashCommandBuilder()
        .setName(commandId)
        .setNameLocalization(localeKey, commandLocales.name)
        .setDescription('Display help text for commands')
        .setDescriptionLocalization(localeKey, commandLocales.description),
    callback: async (logger, client, interaction) => {
        if (!interaction.inGuild()) {
            await interaction.reply({
                content: Locale.generic_responses.not_in_guild,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const locale = interaction.locale;
        const memberPermissions = interaction.memberPermissions;

        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(commandLocales.response.title);

        for (const [, cmd] of client.commands) {
            const commandData = cmd.register();

            if (
                    cmd.isHiddenForHelpCommand()
                || (
                        commandData.contexts
                    && interaction.context
                    && commandData.contexts.includes(interaction.context)
                )
            ) continue;
            
            const requiredPermissions = commandData.default_member_permissions;

            const resolvedPermissions = requiredPermissions !== undefined && requiredPermissions !== null
                ? BigInt(requiredPermissions)
                : null;

            const hasPermission = !resolvedPermissions || memberPermissions.has(resolvedPermissions);

            if (!(commandData.description && hasPermission)) continue;

            const commandName = commandData.name_localizations?.[locale] ?? commandData.name;
            const description = commandData.description_localizations?.[locale] ?? commandData.description;

            helpEmbed.addFields({
                name: `/${commandName}`,
                value: description,
                inline: false,
            });
        }

        await interaction.reply({
            embeds: [helpEmbed],
            flags: MessageFlags.Ephemeral,
        });
    }
});
