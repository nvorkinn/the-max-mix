/** The message of anything that was thrown; a caught value is `unknown`, and not everything thrown is an Error. */
export const errorMessage = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown));
