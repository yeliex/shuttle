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
import { LogOutIcon, MonitorUpIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

import { ShareSettingsForm, TaskReference } from '@/components/invite-dialog.tsx';
import { OpenPreviewButton } from '@/components/preview-detail.tsx';
import {
    deletePreviewService,
    deleteSharedThread,
    leaveSharedThread,
    revokeGrant,
    type ShareGrant,
    type SharedThreadDetail,
    type SharedThreadSummary,
    type ThreadPreviewService,
    updateGrant,
} from '@/libs/api.ts';
import { formatDate, initials } from '@/libs/format.ts';

export function ShareDialog({
    onChanged, onOpenChange, open, thread, view = 'settings',
}: {
    onChanged: () => void;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    thread: SharedThreadSummary;
    view?: 'settings' | 'people';
}) {
    const { mutate } = useSWRConfig();
    const owner = thread.permission === 'owner';
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const detailKey = owner && open ? `/api/shared-threads/${encodeURIComponent(thread.id)}?includeContent=false` : null;
    const detail = useSWR<{ thread: SharedThreadDetail }>(detailKey);
    const refresh = () => {
        if (detailKey) void mutate(detailKey);
        onChanged();
    };

    return (
        <Dialog open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
            <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-xl" showCloseButton={!busy}>
                <DialogHeader>
                    <DialogTitle>{owner ? view === 'people' ? 'Authorized people' : 'Share settings' : 'Shared with you'}</DialogTitle>
                    <DialogDescription>{thread.title || 'Untitled task'}</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
                    {owner ? detail.error ? (
                        <p role="alert" className="text-sm text-destructive">{detail.error.message}</p>
                    ) : !detail.data ? <ManageSkeleton /> : view === 'people' ? (
                        <AccessList detail={detail.data.thread} onChanged={refresh} />
                    ) : (
                        <>
                            <ShareSettingsForm detail={detail.data.thread} onSaved={refresh} onBusyChange={setBusy}>
                                <ServicesList services={detail.data.thread.previewServices} onChanged={refresh} />
                            </ShareSettingsForm>
                            <Separator />
                            <RevokeButton
                                actionLabel="Stop sharing"
                                label="Stop sharing"
                                description="Collaborator access, invitations, and included services will stop immediately."
                                disabled={busy}
                                onRevoke={async () => {
                                    await deleteSharedThread(thread.id);
                                    onOpenChange(false);
                                    onChanged();
                                    toast.success('Task sharing stopped');
                                }}
                            />
                        </>
                    ) : (
                        <>
                            <TaskReference thread={thread} />
                            <Separator />
                            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                            <Button variant="outline" disabled={busy} onClick={async () => {
                                setBusy(true);
                                setError(undefined);
                                try {
                                    await leaveSharedThread(thread.id);
                                    onOpenChange(false);
                                    onChanged();
                                    toast.success('Left shared task');
                                } catch (failure) {
                                    setError(failure instanceof Error ? failure.message : 'Unable to leave this share.');
                                } finally { setBusy(false); }
                            }}>
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
    const expired = Boolean(detail.expiresAt && new Date(detail.expiresAt) <= new Date());
    return (
        <section className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
                {expired ? 'Access has expired for these people.' : detail.expiresAt ? `Access expires ${formatDate(detail.expiresAt)}.` : 'Access remains active until revoked.'}
                {' '}Email recipients are already authorized; no acceptance is required.
            </p>
            {detail.grants?.length ? detail.grants.map((grant) => (
                <GrantRow key={grant.id} grant={grant} hasServices={detail.previewServices.length > 0}
                    sharedThreadId={detail.id} onChanged={onChanged} />
            )) : <p className="text-sm text-muted-foreground">No authorized people yet.</p>}
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
        <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 sm:flex">
            <Avatar className="size-8">
                <AvatarImage src={grant.user?.image ?? undefined} alt="" />
                <AvatarFallback>{initials(grant.user?.name ?? grant.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{grant.user?.name ?? grant.email}</p>
                <p className="truncate text-xs text-muted-foreground">{grant.email}</p>
            </div>
            <div className="col-span-2 flex shrink-0 items-center justify-end gap-2">
                {hasServices && (
                    <Toggle
                        variant="outline"
                        size="sm"
                        pressed={grant.canPreview}
                        disabled={update.isMutating}
                        title="Allow local services"
                        aria-label={`Allow local services for ${grant.user?.name ?? grant.email}`}
                        onPressedChange={async (canPreview) => {
                            try {
                                await update.trigger({ canPreview, permission: grant.permission });
                                onChanged();
                            } catch { toast.error('Unable to update access. Please try again.'); }
                        }}
                    >
                        <MonitorUpIcon />
                    </Toggle>
                )}
                <Select
                    value={grant.permission}
                    disabled={update.isMutating}
                    onValueChange={async (value) => {
                        try {
                            await update.trigger({
                                canPreview: grant.canPreview,
                                permission: value as SharePermission,
                            });
                            onChanged();
                        } catch { toast.error('Unable to update access. Please try again.'); }
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
        </div>
    );
}

function RevokeButton({
    actionLabel = 'Revoke',
    description,
    label,
    onRevoke,
    disabled = false,
}: {
    actionLabel?: string;
    disabled?: boolean;
    description: string;
    label: string;
    onRevoke: () => Promise<void>;
}) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string>();
    return (
        <AlertDialog open={open} onOpenChange={(value) => {
            if (!pending) { setOpen(value); setError(undefined); }
        }}>
            <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size={actionLabel === 'Stop sharing' ? 'default' : 'icon-xs'} disabled={disabled} aria-label={label}><Trash2Icon />{actionLabel === 'Stop sharing' && actionLabel}</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{label}?</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={pending} onClick={async (event) => {
                        event.preventDefault();
                        setPending(true);
                        setError(undefined);
                        try {
                            await onRevoke();
                            setOpen(false);
                        } catch (failure) {
                            setError(failure instanceof Error ? failure.message : 'Unable to revoke access. Please try again.');
                        } finally { setPending(false); }
                    }}>{pending ? 'Removing…' : actionLabel}</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
