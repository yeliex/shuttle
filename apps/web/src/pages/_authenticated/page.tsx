import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Skeleton } from '@/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/ui/table';
import { cn } from '@/ui/libs/utils';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import useSWR from 'swr';

import { OpenPreviewButton } from '@/components/preview-detail.tsx';
import { ShareDialog } from '@/components/thread-detail.tsx';
import type { SharedThreadSummary } from '@/libs/api.ts';
import { formatRelativeTime, initials } from '@/libs/format.ts';

export const Route = createFileRoute('/_authenticated/')({
    component: SharedTasks,
});

function SharedTasks() {
    const tasks = useSWR<{ threads: SharedThreadSummary[] }>('/api/shared-threads');
    const [selectedShare, setSelectedShare] = useState<SharedThreadSummary>();
    const groups = [
        {
            description: 'Tasks teammates have shared with you.',
            empty: 'No tasks have been shared with you yet.',
            owner: false,
            threads: tasks.data?.threads.filter((thread) => thread.permission !== 'owner') ?? [],
            title: 'Shared with me',
        },
        {
            description: 'Tasks you are sharing, including their local services.',
            empty: 'You are not sharing any tasks yet.',
            owner: true,
            threads: tasks.data?.threads.filter((thread) => thread.permission === 'owner') ?? [],
            title: 'Shared by me',
        },
    ] as const;

    return (
        <section className="min-w-0 p-5 sm:p-8">
            <header className="mb-8">
                <p className="text-sm font-medium text-muted-foreground">Workspace</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">Shared tasks</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Each share contains one Codex task and any local services included with it.
                </p>
            </header>

            {tasks.error ? (
                <p className="rounded-2xl border p-6 text-sm text-destructive">{tasks.error.message}</p>
            ) : tasks.isLoading ? (
                <TaskTableSkeleton />
            ) : (
                <div className="space-y-8">
                    {groups.map((group) => (
                        <section key={group.title}>
                            <header className="mb-3">
                                <h2 className="text-base font-semibold">{group.title}</h2>
                                <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
                            </header>
                            <div className="overflow-x-auto rounded-2xl border bg-background">
                                {group.threads.length ? (
                                    <Table className="min-w-[46rem] table-fixed">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[30%]">Task</TableHead>
                                                <TableHead className="w-[30%]">Services</TableHead>
                                                <TableHead className="w-[22%]">
                                                    {group.owner ? 'Device' : 'Owner'}
                                                </TableHead>
                                                <TableHead className="w-[18%] text-right">Updated</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {group.threads.map((thread) => (
                                                <TableRow
                                                    key={thread.id}
                                                    className="cursor-pointer"
                                                    tabIndex={0}
                                                    onClick={() => setSelectedShare(thread)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === 'Enter' || event.key === ' ') {
                                                            event.preventDefault();
                                                            setSelectedShare(thread);
                                                        }
                                                    }}
                                                >
                                                    <TableCell className="max-w-72 truncate font-medium">
                                                        {thread.title || 'Untitled task'}
                                                    </TableCell>
                                                    <TableCell>
                                                        {thread.previewServices.length ? (
                                                            <div className="flex flex-wrap items-center gap-1">
                                                                {thread.previewServices.map((service) => (
                                                                    <span key={service.id} className="inline-flex items-center">
                                                                        <Badge variant="secondary">
                                                                            {service.name} :{service.port}
                                                                        </Badge>
                                                                        <OpenPreviewButton service={service} />
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </TableCell>
                                                    {group.owner ? (
                                                        <TableCell className="max-w-40 truncate text-muted-foreground">
                                                            {thread.device?.name ?? 'Unknown device'}
                                                        </TableCell>
                                                    ) : (
                                                        <TableCell>
                                                            <span className="flex items-center gap-2">
                                                                <Avatar className="size-6">
                                                                    <AvatarImage src={thread.owner.image ?? undefined} alt="" />
                                                                    <AvatarFallback>{initials(thread.owner.name)}</AvatarFallback>
                                                                </Avatar>
                                                                <span className="max-w-32 truncate">{thread.owner.name}</span>
                                                            </span>
                                                        </TableCell>
                                                    )}
                                                    <TableCell className="truncate text-right text-muted-foreground">
                                                        {formatRelativeTime(thread.updatedAt)}
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

            {selectedShare && (
                <ShareDialog
                    open
                    thread={selectedShare}
                    onOpenChange={(open) => !open && setSelectedShare(undefined)}
                    onChanged={() => void tasks.mutate()}
                />
            )}
        </section>
    );
}

function TaskTableSkeleton() {
    return (
        <div className="grid gap-3 rounded-2xl border p-5">
            {[0, 1, 2, 3].map((row) => (
                <div key={row} className={cn('grid grid-cols-[2fr_2fr_1fr_1fr] gap-4', row === 0 && 'opacity-70')}>
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                </div>
            ))}
        </div>
    );
}
