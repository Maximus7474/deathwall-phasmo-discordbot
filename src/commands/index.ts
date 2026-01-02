import SlashCommand from "../classes/slash_command";
import help from "./help";
import ping from "./ping";

export default [
    ping,
    help,
] as SlashCommand[];
