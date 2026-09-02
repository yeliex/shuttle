import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';

type ShuttleAuthClientOptions = {
    plugins: [ReturnType<typeof magicLinkClient>];
};

export const authClient: ReactAuthClient<ShuttleAuthClientOptions> = createAuthClient({
    plugins: [magicLinkClient()],
});
