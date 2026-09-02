import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/ui/card';
import { ShuttleLogo } from '@/ui/shuttle-logo';
import { Spinner } from '@/ui/spinner';
import { createFileRoute } from '@tanstack/react-router';
import { LaptopIcon, LockKeyholeIcon } from 'lucide-react';
import useSWRMutation from 'swr/mutation';

import { createDevice } from '@/libs/api.ts';
import { authClient } from '@/libs/auth.ts';

export const Route = createFileRoute('/device-connect/')({
    validateSearch: (search: Record<string, unknown>) => ({
        callback: typeof search.callback === 'string' ? search.callback : undefined,
        name: typeof search.name === 'string' ? search.name : undefined,
    }),
    component: DeviceConnect,
});

function DeviceConnect() {
    const search = Route.useSearch();
    const session = authClient.useSession();
    const deviceName = search.name?.trim().slice(0, 100) || 'This Mac';
    const callbackValid = search.callback === 'shuttle://device-connected';
    const connection = useSWRMutation(
        callbackValid ? ['connect-device', deviceName] : null,
        () => createDevice(deviceName),
    );

    const connect = async () => {
        const result = await connection.trigger();
        const callback = new URL('shuttle://device-connected');
        callback.searchParams.set('relay', window.location.origin);
        callback.searchParams.set('token', result.token);
        window.location.assign(callback);
    };

    const loginURL = new URL(`${import.meta.env.BASE_URL}login`, window.location.origin);
    loginURL.searchParams.set('redirect', `${window.location.pathname}${window.location.search}`);

    return (
        <main className="relative grid min-h-screen place-items-center bg-muted/25 px-5 py-16">
            <a href={import.meta.env.BASE_URL} className="absolute left-6 top-6"><ShuttleLogo /></a>
            <Card className="w-full max-w-md shadow-lg shadow-black/5">
                <CardHeader className="text-center">
                    <span className="mx-auto mb-2 grid size-12 place-items-center rounded-2xl bg-muted">
                        <LaptopIcon className="size-5" />
                    </span>
                    <CardTitle className="text-xl">Connect {deviceName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Allow this Mac to run your Shuttle Companion.
                    </p>
                </CardHeader>
                <CardContent className="grid gap-5">
                    {!callbackValid ? (
                        <p className="text-center text-sm text-destructive">This connection link is invalid.</p>
                    ) : session.isPending ? (
                        <div className="grid h-28 place-items-center"><Spinner className="size-5" /></div>
                    ) : !session.data ? (
                        <Button asChild><a href={loginURL.toString()}>Sign in to continue</a></Button>
                    ) : (
                        <>
                            <Alert>
                                <LockKeyholeIcon />
                                <AlertTitle>Only explicit shares leave this Mac</AlertTitle>
                                <AlertDescription>
                                    The Companion cannot discover unshared tasks or ports. You can revoke this device from Shuttle at any time.
                                </AlertDescription>
                            </Alert>
                            <dl className="grid gap-3 text-sm">
                                <div>
                                    <dt className="text-muted-foreground">Account</dt>
                                    <dd className="mt-1 font-medium">{session.data.user.email}</dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">Relay</dt>
                                    <dd className="mt-1 truncate font-medium">{window.location.origin}</dd>
                                </div>
                            </dl>
                        </>
                    )}
                    {connection.error && <p className="text-sm text-destructive">{connection.error.message}</p>}
                </CardContent>
                {session.data && callbackValid && (
                    <CardFooter>
                        <Button className="w-full" onClick={connect} disabled={connection.isMutating}>
                            {connection.isMutating && <Spinner />}Connect this Mac
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </main>
    );
}
