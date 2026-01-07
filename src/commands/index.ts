import SlashCommand from "../classes/slash_command";
import help from "./help";
import ping from "./ping";
import session from "./session";

export default [
    ping,
    help,
    session,
] as SlashCommand[];
