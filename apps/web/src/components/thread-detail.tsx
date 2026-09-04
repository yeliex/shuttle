import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Separator } from '@/ui/separator';
import { Skeleton } from '@/ui/skeleton';
import { toast } from '@/ui/sonner';
import { Toggle } from '@/ui/toggle';
import type { SharePermission } from '@shuttle/contracts';
import { Clock3Icon, CopyIcon, LogOutIcon, MonitorUpIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

import { InviteDialog } from '@/components/invite-dialog.tsx';
import { OpenPreviewButton } from '@/components/preview-detail.tsx';
import {
    deletePreviewService,
    deleteSharedThread,
    leaveSharedThread,
    revokeGrant,
    revokeInvite,
    type ShareGrant,
    type ShareInvite,
    type SharedThreadDetail,
    type SharedThreadSummary,
    type ThreadPreviewService,
    updateGrant,
} from '@/libs/api.ts';
import { formatDate, initials } from '@/libs/format.ts';

export function ShareDialog({
    onChanged,
    onOpenChange,
    open,
    thread,
}: {
    onChanged: () => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    thread: SharedThreadSummary;
}) {
    const { mutate } = useSWRConfig();
    const owner = thread.permission === 'owner';
    const [leaving, setLeaving] = useState(false);
    const detailKey = owner && open
        ? `/api/shared-threads/${encodeURIComponent(thread.id)}?includeContent=false`
        : null;
    const detail = useSWR<{ thread: SharedThreadDetail }>(detailKey);
    const deletion = useSWRMutation(
        ['delete-shared-thread', thread.id],
        () => deleteSharedThread(thread.id),
    );
    const refresh = () => {
        if (detailKey) {
            void mutate(detailKey);
        }
        onChanged();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{thread.title || 'Untitled task'}</DialogTitle>
                    <DialogDescription>
                        {owner
                            ? 'Manage this share, its collaborators, and included local services.'
                            : `Shared by ${thread.owner.name}. Use it from your own Codex task.`}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
                    <TaskReference thread={thread} />
                    {owner && <Separator />}
                    {owner && (detail.error ? (
                        <p className="text-sm text-destructive">{detail.error.message}</p>
                    ) : detail.isLoading || !detail.data ? (
                        <ManageSkeleton />
                    ) : (
                        <>
                            <InviteDialog
                                sharedThreadId={thread.id}
                                title={thread.title || 'Untitled task'}
                                hasServices={detail.data.thread.previewServices.length > 0}
                                onCreated={refresh}
                            />
                            <Separator />
                            <ServicesList
                                services={detail.data.thread.previewServices}
                                onChanged={refresh}
                            />
                            <Separator />
                            <AccessList detail={detail.data.thread} onChanged={refresh} />
                            <Separator />
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button variant="destructive">
                                        <Trash2Icon data-icon="inline-start" />
                                        Stop sharing
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Stop sharing this task?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            Collaborator access, invitations, and included services will stop immediately.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                            variant="destructive"
                                            onClick={async () => {
                                                await deletion.trigger();
                                                onOpenChange(false);
                                                onChanged();
                                                toast.success('Task sharing stopped');
                                            }}
                                        >Stop sharing</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </>
                    ))}
                    {!owner && (
                        <>
                            <Separator />
                            <Button
                                variant="outline"
                                disabled={leaving}
                                onClick={async () => {
                                    setLeaving(true);
                                    try {
                                        await leaveSharedThread(thread.id);
                                        onOpenChange(false);
                                        onChanged();
                                        toast.success('Left shared task');
                                    } finally {
                                        setLeaving(false);
                                    }
                                }}
                            >
                                <LogOutIcon data-icon="inline-start" />
                                Leave shared task
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

function TaskReference({ thread }: { thread: SharedThreadSummary }) {
    const deepLink = `shuttle://shared/${thread.id}`;
    const messageInstruction = thread.permission === 'read'
        ? 'This share is read-only.'
        : thread.permission === 'owner'
            ? "If the collaborator has message permission, use Shuttle's send_shared_message tool for the same shared task."
            : "To send feedback, use Shuttle's send_shared_message tool for the same shared task.";
    const prompt = `Use the Shuttle skill in a new Codex task to read:
${deepLink}

If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. ${messageInstruction}`;

    return (
        <section>
            <h3 className="text-sm font-semibold">Use in Codex</h3>
            <div className="mt-3 flex items-center gap-2 rounded-xl border p-3">
                <code className="min-w-0 flex-1 truncate text-xs">{deepLink}</code>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Copy deep link"
                    aria-label="Copy task deep link"
                    onClick={async () => {
                        await navigator.clipboard.writeText(deepLink);
                        toast.success('Deep link copied');
                    }}
                >
                    <CopyIcon />
                </Button>
            </div>
            <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-4 font-mono text-xs leading-5 text-muted-foreground">
                {prompt}
            </pre>
            <Button
                className="mt-3"
                variant="outline"
                onClick={async () => {
                    await navigator.clipboard.writeText(prompt);
                    toast.success('Codex prompt copied');
                }}
            >
                <CopyIcon data-icon="inline-start" />
                Copy prompt
            </Button>
        </section>
    );
}

function ManageSkeleton() {
    return (
        <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
        </div>
    );
}

function ServicesList({
    onChanged,
    services,
}: {
    onChanged: () => void;
    services: ThreadPreviewService[];
}) {
    return (
        <section>
            <h3 className="text-sm font-semibold">Local services</h3>
            <div className="mt-3 flex flex-col gap-2">
                {services.length ? services.map((service) => (
                    <ServiceRow key={service.id} service={service} onChanged={onChanged} />
                )) : (
                    <p className="text-sm text-muted-foreground">
                        No local services are included in this share.
                    </p>
                )}
            </div>
        </section>
    );
}

function ServiceRow({
    onChanged,
    service,
}: {
    onChanged: () => void;
    service: ThreadPreviewService;
}) {
    const deletion = useSWRMutation(
        ['delete-preview', service.id],
        () => deletePreviewService(service.id),
    );

    return (
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2">
            <MonitorUpIcon className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{service.name}</p>
                <p className="text-xs text-muted-foreground">Port {service.port}</p>
            </div>
            <OpenPreviewButton service={service} />
            <RevokeButton
                actionLabel="Remove"
                label={`Remove ${service.name}`}
                description="This service will no longer be available through this task share."
                onRevoke={async () => {
                    await deletion.trigger();
                    onChanged();
                }}
            />
        </div>
    );
}

function AccessList({ detail, onChanged }: { detail: SharedThreadDetail; onChanged: () => void }) {
    const hasServices = detail.previewServices.length > 0;
    return (
        <section>
            <h3 className="text-sm font-semibold">People with access</h3>
            <div className="mt-3 flex flex-col gap-3">
                {detail.grants?.length ? detail.grants.map((grant) => (
                    <GrantRow
                        key={grant.id}
                        grant={grant}
                        hasServices={hasServices}
                        sharedThreadId={detail.id}
                        onChanged={onChanged}
                    />
                )) : <p className="text-sm text-muted-foreground">No collaborators yet.</p>}
            </div>

            {!!detail.invites?.length && (
                <>
                    <h3 className="mt-6 text-sm font-semibold">Invitations</h3>
                    <div className="mt-3 flex flex-col gap-3">
                        {detail.invites.map((invite) => (
                            <InviteRow
                                key={invite.id}
                                invite={invite}
                                sharedThreadId={detail.id}
                                onChanged={onChanged}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

function GrantRow({
    grant,
    hasServices,
    onChanged,
    sharedThreadId,
}: {
    grant: ShareGrant;
    hasServices: boolean;
    onChanged: () => void;
    sharedThreadId: string;
}) {
    const update = useSWRMutation(
        ['update-grant', sharedThreadId, grant.id],
        (_key, { arg }: { arg: { canPreview: boolean; permission: SharePermission } }) => (
            updateGrant(sharedThreadId, grant.id, arg)
        ),
    );
    const revoke = useSWRMutation(
        ['revoke-grant', sharedThreadId, grant.id],
        () => revokeGrant(sharedThreadId, grant.id),
    );

    return (
        <div className="flex items-center gap-2">
            <Avatar className="size-8">
                <AvatarImage src={grant.user?.image ?? undefined} alt="" />
                <AvatarFallback>{initials(grant.user?.name ?? grant.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{grant.user?.name ?? grant.email}</p>
                <p className="truncate text-xs text-muted-foreground">{grant.email}</p>
            </div>
            {hasServices && (
                <Toggle
                    variant="outline"
                    size="sm"
                    pressed={grant.canPreview}
                    disabled={update.isMutating}
                    title="Allow local services"
                    aria-label={`Allow local services for ${grant.user?.name ?? grant.email}`}
                    onPressedChange={async (canPreview) => {
                        await update.trigger({ canPreview, permission: grant.permission });
                        onChanged();
                    }}
                >
                    <MonitorUpIcon />
                </Toggle>
            )}
            <Select
                value={grant.permission}
                disabled={update.isMutating}
                onValueChange={async (value) => {
                    await update.trigger({
                        canPreview: grant.canPreview,
                        permission: value as SharePermission,
                    });
                    onChanged();
                }}
            >
                <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="read">Read only</SelectItem>
                        <SelectItem value="message">Read & message</SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
            <RevokeButton
                label={`Remove ${grant.user?.name ?? grant.email}`}
                description="They will immediately lose access to this shared task and its services."
                onRevoke={async () => {
                    await revoke.trigger();
                    onChanged();
                }}
            />
        </div>
    );
}

function InviteRow({
    invite,
    onChanged,
    sharedThreadId,
}: {
    invite: ShareInvite;
    onChanged: () => void;
    sharedThreadId: string;
}) {
    const revoke = useSWRMutation(
        ['revoke-invite', sharedThreadId, invite.id],
        () => revokeInvite(sharedThreadId, invite.id),
    );
    const expired = Boolean(invite.expiresAt && new Date(invite.expiresAt) <= new Date());
    const status = expired ? 'Expired' : invite.singleUse && invite.acceptedAt ? 'Claimed' : 'Active';

    return (
        <div className="rounded-xl border p-3 text-sm">
            <div className="flex items-center gap-3">
                <Clock3Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{invite.restricted ? 'Selected people' : 'Anyone with the link'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {status} · {invite.canPreview ? 'Task and services' : 'Task only'} · expires {invite.expiresAt ? formatDate(invite.expiresAt) : 'Never'}
                    </p>
                </div>
                {invite.inviteURL && !expired && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Copy invitation link"
                        aria-label="Copy public invitation link"
                        onClick={async () => {
                            await navigator.clipboard.writeText(invite.inviteURL ?? '');
                            toast.success('Invitation link copied');
                        }}
                    >
                        <CopyIcon />
                    </Button>
                )}
                {!expired && (
                    <RevokeButton
                        label="Revoke invitation"
                        description="This invitation link will stop working immediately."
                        onRevoke={async () => {
                            await revoke.trigger();
                            onChanged();
                        }}
                    />
                )}
            </div>
            {invite.inviteURL && (
                <p className="mt-2 truncate pl-7 font-mono text-xs text-muted-foreground">
                    {invite.inviteURL}
                </p>
            )}
        </div>
    );
}

function RevokeButton({
    actionLabel = 'Revoke',
    description,
    label,
    onRevoke,
}: {
    actionLabel?: string;
    description: string;
    label: string;
    onRevoke: () => Promise<void>;
}) {
    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label={label}><Trash2Icon /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{label}?</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={onRevoke}>{actionLabel}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
