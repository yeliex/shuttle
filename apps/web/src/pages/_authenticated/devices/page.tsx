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
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/empty';
import { Skeleton } from '@/ui/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { LaptopIcon, Trash2Icon } from 'lucide-react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

import { revokeDevice, type Device } from '@/libs/api.ts';
import { formatDate, formatRelativeTime } from '@/libs/format.ts';

export const Route = createFileRoute('/_authenticated/devices/')({
    component: Devices,
});

function Devices() {
    const { data, error, isLoading, mutate } = useSWR<{ devices: Device[] }>('/api/devices');

    return (
        <section className="mx-auto min-h-screen max-w-5xl p-5 sm:p-8 lg:p-10">
            <header className="mb-8">
                <p className="text-sm font-medium text-muted-foreground">Account</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">Devices</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Macs that can synchronize your explicitly shared Codex tasks and deliver approved messages.
                </p>
            </header>

            <div className="overflow-hidden rounded-2xl border bg-background">
                {error ? (
                    <p className="p-6 text-sm text-destructive">{error.message}</p>
                ) : isLoading ? (
                    <div className="grid gap-4 p-5">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                    </div>
                ) : data?.devices.length ? data.devices.map((device, index) => (
                    <DeviceRow
                        key={device.id}
                        device={device}
                        bordered={index > 0}
                        onRevoked={() => void mutate()}
                    />
                )) : (
                    <Empty className="min-h-80">
                        <EmptyHeader>
                            <EmptyMedia variant="icon"><LaptopIcon /></EmptyMedia>
                            <EmptyTitle>No connected devices</EmptyTitle>
                            <EmptyDescription>
                                Sign in from the Shuttle macOS app to register this Mac.
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                )}
            </div>
        </section>
    );
}

function DeviceRow({
    bordered,
    device,
    onRevoked,
}: {
    bordered: boolean;
    device: Device;
    onRevoked: () => void;
}) {
    const revoke = useSWRMutation(
        ['revoke-device', device.id],
        () => revokeDevice(device.id),
    );

    return (
        <div className={`flex items-center gap-4 px-5 py-4 ${bordered ? 'border-t' : ''}`}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
                <LaptopIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{device.name}</p>
                    <Badge variant={device.revokedAt ? 'outline' : 'secondary'}>
                        {device.revokedAt ? 'Revoked' : device.online ? 'Online' : 'Offline'}
                    </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                    Last seen {formatRelativeTime(device.lastSeenAt)} · added {formatDate(device.createdAt)}
                </p>
            </div>
            {!device.revokedAt && (
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Revoke ${device.name}`}>
                            <Trash2Icon />
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Revoke {device.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This device will stop syncing tasks and receiving messages immediately.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                variant="destructive"
                                onClick={async () => {
                                    await revoke.trigger();
                                    onRevoked();
                                }}
                            >
                                Revoke device
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}
