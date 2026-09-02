import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Skeleton } from '@/ui/skeleton';
import { toast } from '@/ui/sonner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import { CopyIcon } from 'lucide-react';
import useSWR from 'swr';

import { OpenPreviewButton } from '@/components/preview-detail.tsx';
import type { PreviewServiceSummary } from '@/libs/api.ts';
import { formatRelativeTime, initials } from '@/libs/format.ts';

export const Route = createFileRoute('/_authenticated/services/')({
    component: Services,
});

function Services() {
    const services = useSWR<{ services: PreviewServiceSummary[] }>('/api/preview-services');
    const groups = [
        {
            description: 'Local services included in tasks shared with you.',
            empty: 'No services have been shared with you yet.',
            owner: false,
            services: services.data?.services.filter((service) => service.permission !== 'owner') ?? [],
            title: 'Shared with me',
        },
        {
            description: 'Local services configured under tasks you share.',
            empty: 'You are not sharing any services yet.',
            owner: true,
            services: services.data?.services.filter((service) => service.permission === 'owner') ?? [],
            title: 'Shared by me',
        },
    ] as const;

    return (
        <section className="min-w-0 p-5 sm:p-8">
            <header className="mb-8">
                <p className="text-sm font-medium text-muted-foreground">Preview</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">Shared services</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Open services here. Access and configuration are managed from their task share.
                </p>
            </header>

            {services.error ? (
                <p className="rounded-2xl border p-6 text-sm text-destructive">{services.error.message}</p>
            ) : services.isLoading ? (
                <div className="grid gap-3 rounded-2xl border p-5">
                    {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-10" />)}
                </div>
            ) : (
                <div className="space-y-8">
                    {groups.map((group) => (
                        <section key={group.title}>
                            <header className="mb-3">
                                <h2 className="text-base font-semibold">{group.title}</h2>
                                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
                            </header>
                            <div className="overflow-x-auto rounded-2xl border bg-background">
                                {group.services.length ? (
                                    <Table className="min-w-[48rem] table-fixed">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[34%]">Service</TableHead>
                                                <TableHead className="w-[15%]">Port</TableHead>
                                                <TableHead className="w-[23%]">{group.owner ? 'Device' : 'Owner'}</TableHead>
                                                <TableHead className="w-[14%] text-right">Updated</TableHead>
                                                <TableHead className="w-[14%] text-right">Link</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {group.services.map((service) => (
                                                <TableRow key={service.id}>
                                                    <TableCell className="max-w-72 font-medium">
                                                        <p className="truncate">{service.name}</p>
                                                        <p className="mt-1 truncate text-xs font-normal text-muted-foreground">
                                                            {service.sharedThread.title || 'Untitled task'}
                                                        </p>
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="flex items-center gap-1 text-muted-foreground">
                                                            {service.port}
                                                            <OpenPreviewButton
                                                                service={service}
                                                                disabled={Boolean(service.device?.revokedAt)}
                                                            />
                                                        </span>
                                                    </TableCell>
                                                    {group.owner ? (
                                                        <TableCell className="max-w-40 truncate text-muted-foreground">
                                                            {service.device?.name ?? 'Unknown device'}
                                                        </TableCell>
                                                    ) : (
                                                        <TableCell>
                                                            <span className="flex items-center gap-2">
                                                                <Avatar className="size-6">
                                                                    <AvatarImage src={service.owner.image ?? undefined} alt="" />
                                                                    <AvatarFallback>{initials(service.owner.name)}</AvatarFallback>
                                                                </Avatar>
                                                                <span className="max-w-32 truncate">{service.owner.name}</span>
                                                            </span>
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="truncate text-right text-muted-foreground">
                                                        {formatRelativeTime(service.updatedAt)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon-sm"
                                                            title="Copy service link"
                                                            aria-label={`Copy link for ${service.name}`}
                                                            onClick={async () => {
                                                                await navigator.clipboard.writeText(`shuttle://service/${service.id}`);
                                                                toast.success('Service link copied');
                                                            }}
                                                        >
                                                            <CopyIcon />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                ) : (
                                    <p className="p-8 text-center text-sm text-muted-foreground">{group.empty}</p>
                                )}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </section>
    );
}
