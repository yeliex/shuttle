import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/ui/card';
import { ShuttleLogo } from '@/ui/shuttle-logo';
import { Spinner } from '@/ui/spinner';
import { toast } from '@/ui/sonner';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2Icon, CheckIcon, CopyIcon, LockKeyholeIcon, MailIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

import { acceptInvite, inspectInvite } from '@/libs/api.ts';
import { authClient } from '@/libs/auth.ts';
import { formatDate, initials } from '@/libs/format.ts';

export const Route = createFileRoute('/invite/')({
    component: Invitation,
});

function Invitation() {
    const session = authClient.useSession();
    const [acceptedThreadId, setAcceptedThreadId] = useState<string>();
    const [token] = useState(() => (
        window.location.hash.slice(1)
        || window.sessionStorage.getItem('shuttle:invite-token')
        || ''
    ));

    useEffect(() => {
        if (token && !window.location.hash) {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${token}`);
        }
        window.sessionStorage.removeItem('shuttle:invite-token');
    }, [token]);

    const invitation = useSWR(
        token && session.data ? ['invite', token] as const : null,
        ([, inviteToken]) => inspectInvite(inviteToken),
    );
    const acceptance = useSWRMutation(
        token ? ['accept-invite', token] as const : null,
        (_key, { arg }: { arg: string }) => acceptInvite(arg),
    );
    const accessibleThreadId = acceptedThreadId
        ?? (invitation.data?.invite.hasAccess ? invitation.data.invite.sharedThread.id : undefined);

    const accept = async () => {
        const result = await acceptance.trigger(token);
        if (invitation.data?.invite.recipientEmailBound === false) {
            setAcceptedThreadId(result.sharedThreadId);
            return;
        }
        const destination = new URL(import.meta.env.BASE_URL, window.location.origin);
        destination.searchParams.set('thread', result.sharedThreadId);
        window.location.assign(destination);
    };

    const loginURL = new URL(`${import.meta.env.BASE_URL}login`, window.location.origin);
    loginURL.searchParams.set('redirect', window.location.pathname);
    loginURL.hash = token;

    return (
        <main className="relative grid min-h-screen place-items-center bg-muted/25 px-5 py-16">
            <a href={import.meta.env.BASE_URL} className="absolute left-6 top-6">
                <ShuttleLogo />
            </a>

            <Card className="w-full max-w-md shadow-lg shadow-black/5">
                <CardHeader className="text-center">
                    <CardTitle className="text-xl">
                        {accessibleThreadId ? 'Shared with you' : 'Task invitation'}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                        {accessibleThreadId
                            ? 'Continue from your own Codex task with the prompt below.'
                            : 'Review exactly what this invitation permits before accepting.'}
                    </p>
                </CardHeader>
                <CardContent>
                    {accessibleThreadId ? (
                        <AcceptedInvitation sharedThreadId={accessibleThreadId} />
                    ) : !token ? (
                        <InvitationError message="This invitation link is incomplete." />
                    ) : session.isPending ? (
                        <div className="grid h-52 place-items-center"><Spinner className="size-5" /></div>
                    ) : !session.data ? (
                        <div className="grid gap-5 text-center">
                            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted">
                                <MailIcon className="size-5" />
                            </span>
                            <div>
                                <h2 className="font-semibold">Sign in to review this invitation</h2>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Sign in with an authorized email to access this task.
                                </p>
                            </div>
                            <Button asChild><a href={loginURL.toString()}>Continue to sign in</a></Button>
                        </div>
                    ) : invitation.isLoading ? (
                        <div className="grid h-52 place-items-center"><Spinner className="size-5" /></div>
                    ) : invitation.error ? (
                        <InvitationError message={invitation.error.message} />
                    ) : invitation.data ? (
                        <div className="grid gap-5">
                            <div className="flex items-center gap-3 rounded-2xl bg-muted/55 p-4">
                                <Avatar className="size-10">
                                    <AvatarImage src={invitation.data.invite.sharedThread.owner.image ?? undefined} alt="" />
                                    <AvatarFallback>{initials(invitation.data.invite.sharedThread.owner.name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium">
                                        {invitation.data.invite.sharedThread.owner.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">invited you to a Codex task</p>
                                </div>
                            </div>
                            <dl className="grid gap-4 text-sm">
                                <div>
                                    <dt className="text-muted-foreground">Task</dt>
                                    <dd className="mt-1 font-medium">
                                        {invitation.data.invite.sharedThread.title || 'Untitled task'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-muted-foreground">Permission</dt>
                                    <dd className="mt-1 flex items-center gap-2 font-medium">
                                        <CheckIcon className="size-4" />
                                        {invitation.data.invite.permission === 'message'
                                            ? 'Read the full task and send messages'
                                            : 'Read the full task'}
                                    </dd>
                                </div>
                                {invitation.data.invite.canPreview && (
                                    <div>
                                        <dt className="text-muted-foreground">Local services</dt>
                                        <dd className="mt-1 flex items-center gap-2 font-medium">
                                            <CheckIcon className="size-4" />
                                            Open services included in this task share
                                        </dd>
                                    </div>
                                )}
                                <div>
                                    <dt className="text-muted-foreground">Expires</dt>
                                    <dd className="mt-1 font-medium">{invitation.data.invite.expiresAt ? formatDate(invitation.data.invite.expiresAt) : 'Never'}</dd>
                                </div>
                            </dl>
                            <Alert>
                                <LockKeyholeIcon />
                                <AlertTitle>Your local Codex stays separate</AlertTitle>
                                <AlertDescription>
                                    This only grants access to the named task. It does not expose repositories, commands, or any other task.
                                </AlertDescription>
                            </Alert>
                        </div>
                    ) : null}
                    {acceptance.error && (
                        <p className="mt-4 text-sm text-destructive">{acceptance.error.message}</p>
                    )}
                </CardContent>
                {session.data && invitation.data && !accessibleThreadId && (
                    <CardFooter className="flex-col gap-3">
                        <Button className="w-full" onClick={accept} disabled={acceptance.isMutating}>
                            {acceptance.isMutating && <Spinner />}
                            Accept invitation
                        </Button>
                        <p className="text-center text-xs text-muted-foreground">
                            Signed in as {session.data.user.email}
                        </p>
                    </CardFooter>
                )}
            </Card>
        </main>
    );
}

function AcceptedInvitation({ sharedThreadId }: { sharedThreadId: string }) {
    const usagePrompt = `Use the Share Thread ($share-thread) skill in a new Codex task to read:
shuttle://shared/${sharedThreadId}

If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. To send feedback, use Shuttle's send_shared_message tool for the same shared task.`;

    const copyPrompt = async () => {
        await navigator.clipboard.writeText(usagePrompt);
        toast.success('Prompt copied');
    };

    return (
        <div className="grid gap-5">
            <Alert>
                <CheckCircle2Icon />
                <AlertTitle>This task is now shared with you</AlertTitle>
                <AlertDescription>
                    Shuttle keeps the collaboration inside your own Codex task.
                </AlertDescription>
            </Alert>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-4 font-mono text-xs leading-5 text-muted-foreground">
                {usagePrompt}
            </pre>
            <div className="grid gap-2">
                <Button className="w-full" onClick={copyPrompt}>
                    <CopyIcon />
                    Copy prompt
                </Button>
                <Button asChild className="w-full" variant="outline">
                    <a href={import.meta.env.BASE_URL}>Open Shuttle dashboard</a>
                </Button>
            </div>
        </div>
    );
}

function InvitationError({ message }: { message: string }) {
    return (
        <div className="grid h-52 place-items-center text-center">
            <div>
                <h2 className="font-semibold">Invitation unavailable</h2>
                <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            </div>
        </div>
    );
}
