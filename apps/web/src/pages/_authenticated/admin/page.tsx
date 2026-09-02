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
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/ui/dialog';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from '@/ui/field';
import { Input } from '@/ui/input';
import { Skeleton } from '@/ui/skeleton';
import { toast } from '@/ui/sonner';
import { Spinner } from '@/ui/spinner';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/ui/table';
import { createFileRoute } from '@tanstack/react-router';
import {
    LaptopIcon,
    MessagesSquareIcon,
    PlusIcon,
    RadioTowerIcon,
    UsersIcon,
} from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import {
    createAdminUser,
    setUserDisabled,
    type AdminOverview,
} from '@/libs/api.ts';
import { formatDate, initials } from '@/libs/format.ts';

export const Route = createFileRoute('/_authenticated/admin/')({
    component: Admin,
});

function Admin() {
    const { data, error, isLoading, mutate } = useSWR<AdminOverview>('/api/admin/overview');
    const [updatingUserId, setUpdatingUserId] = useState<string>();
    const updateUser = async (userId: string, disabled: boolean) => {
        setUpdatingUserId(userId);
        try {
            await setUserDisabled(userId, disabled);
            await mutate();
            toast.success(disabled ? 'Account disabled' : 'Account enabled');
        } catch (updateError) {
            toast.error(updateError instanceof Error ? updateError.message : 'Account update failed');
        } finally {
            setUpdatingUserId(undefined);
        }
    };
    const metrics = data ? [
        { icon: UsersIcon, label: 'Users', value: data.metrics.users },
        { icon: LaptopIcon, label: 'Active devices', value: data.metrics.activeDevices },
        { icon: MessagesSquareIcon, label: 'Shared tasks', value: data.metrics.sharedThreads },
        { icon: RadioTowerIcon, label: 'Previews', value: data.metrics.previewServices },
    ] : [];

    return (
        <section className="mx-auto min-h-screen max-w-6xl p-5 sm:p-8 lg:p-10">
            <header className="mb-8 flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-muted-foreground">Deployment</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight">Relay admin</h1>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                        Basic account and resource status for this single Shuttle Relay.
                    </p>
                </div>
                <CreateUserDialog onCreated={() => void mutate()} />
            </header>

            {error ? (
                <p className="rounded-2xl border p-6 text-sm text-destructive">{error.message}</p>
            ) : isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28" />)}
                </div>
            ) : data ? (
                <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {metrics.map(({ icon: Icon, label, value }) => (
                            <Card key={label}>
                                <CardHeader className="flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium">{label}</CardTitle>
                                    <Icon className="size-4 text-muted-foreground" />
                                </CardHeader>
                                <CardContent><p className="text-3xl font-semibold">{value}</p></CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="mt-8 overflow-hidden rounded-2xl border bg-background">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>User</TableHead>
                                    <TableHead>Tasks</TableHead>
                                    <TableHead>Previews</TableHead>
                                    <TableHead>Devices</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Joined</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data.users.map((user) => (
                                    <TableRow key={user.id}>
                                        <TableCell>
                                            <span className="flex items-center gap-3">
                                                <Avatar className="size-8">
                                                    <AvatarImage src={user.image ?? undefined} alt="" />
                                                    <AvatarFallback>{initials(user.name)}</AvatarFallback>
                                                </Avatar>
                                                <span className="min-w-0">
                                                    <span className="block truncate font-medium">{user.name}</span>
                                                    <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell>{user._count.ownedThreads}</TableCell>
                                        <TableCell>{user._count.ownedPreviewServices}</TableCell>
                                        <TableCell>{user._count.devices}</TableCell>
                                        <TableCell>
                                            <Badge variant={user.disabledAt ? 'destructive' : 'secondary'}>
                                                {user.disabledAt ? 'Disabled' : 'Active'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                                        <TableCell className="text-right">
                                            {user.isAdmin ? (
                                                <span className="text-xs text-muted-foreground">Administrator</span>
                                            ) : user.disabledAt ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={updatingUserId === user.id}
                                                    onClick={() => void updateUser(user.id, false)}
                                                >
                                                    {updatingUserId === user.id && <Spinner />}
                                                    Enable
                                                </Button>
                                            ) : (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            disabled={updatingUserId === user.id}
                                                        >
                                                            {updatingUserId === user.id && <Spinner />}
                                                            Disable
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Disable {user.name}?</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                Their browser sessions will end and registered devices will be revoked.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                            <AlertDialogAction
                                                                variant="destructive"
                                                                onClick={() => void updateUser(user.id, true)}
                                                            >Disable account</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </>
            ) : null}
        </section>
    );
}

function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
    const [open, setOpen] = useState(false);
    const [error, setError] = useState<string>();
    const [isSubmitting, setSubmitting] = useState(false);

    const submit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        try {
            await createAdminUser({
                email: String(form.get('email') ?? ''),
                name: String(form.get('name') ?? ''),
            });
            onCreated();
            setOpen(false);
            toast.success('Account created');
        } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Account creation failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (nextOpen) {
                    setError(undefined);
                }
            }}
        >
            <DialogTrigger asChild>
                <Button>
                    <PlusIcon data-icon="inline-start" />
                    Add user
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add user</DialogTitle>
                    <DialogDescription>
                        Pre-create an account when registration is restricted.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={submit}>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor="admin-user-name">Name</FieldLabel>
                            <Input id="admin-user-name" name="name" autoComplete="name" required />
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="admin-user-email">Email</FieldLabel>
                            <Input
                                id="admin-user-email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                            />
                            <FieldDescription>
                                They can sign in with a one-time email link and set a password afterward.
                            </FieldDescription>
                        </Field>
                        <FieldError>{error}</FieldError>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="outline" disabled={isSubmitting}>
                                    Cancel
                                </Button>
                            </DialogClose>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Spinner />}
                                Create account
                            </Button>
                        </DialogFooter>
                    </FieldGroup>
                </form>
            </DialogContent>
        </Dialog>
    );
}
