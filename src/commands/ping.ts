import { MessageFlags, SlashCommandBuilder } from "discord.js";
import SlashCommand from "../classes/slash_command";
import { getCommandLocalization } from "../utils/localeLoader";

const commandId = 'ping';
const commandLocales = getCommandLocalization(commandId);

export default new SlashCommand({
    name: commandId,
    guildSpecific: false,
    hideFromHelp: false,
    slashcommand: new SlashCommandBuilder()
        .setName(commandLocales.name)
        .setDescription(commandLocales.description),
    callback: async (logger, client, interaction) => {
        logger.success('Successfully received usage of /ping from discord API');
        await interaction.reply({
            // Ping is calculated by subtracting the current timestamp from the interaction created timestamp
            // This is not the best way to calculate ping, but it is a good approximation
            content: `${commandLocales.response.text} (${interaction.createdTimestamp - Date.now()} ms)`,
            flags: MessageFlags.Ephemeral,
        })
    }
});