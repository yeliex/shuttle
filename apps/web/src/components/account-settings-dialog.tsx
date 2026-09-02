import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/ui/dialog';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
} from '@/ui/field';
import { Input } from '@/ui/input';
import { cn } from '@/ui/libs/utils';
import { toast } from '@/ui/sonner';
import { Spinner } from '@/ui/spinner';
import { CircleAlertIcon, KeyRoundIcon, LinkIcon, UserRoundIcon } from 'lucide-react';
import { useState } from 'react';

import { setInitialPassword, type ConfigResponse, type MeResponse } from '@/libs/api.ts';
import { authClient } from '@/libs/auth.ts';
import { initials } from '@/libs/format.ts';

interface AccountSettingsDialogProps {
    configuration?: ConfigResponse;
    data?: MeResponse;
    onOpenChange: (open: boolean) => void;
    onProfileChanged: () => Promise<unknown>;
    open: boolean;
    section: 'account' | 'security';
    onSectionChange: (section: 'account' | 'security') => void;
}

export function AccountSettingsDialog({
    configuration,
    data,
    onOpenChange,
    onProfileChanged,
    onSectionChange,
    open,
    section,
}: AccountSettingsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="h-[min(680px,calc(100vh-2rem))] gap-0 overflow-hidden p-0 sm:max-w-3xl">
                <DialogHeader className="sr-only">
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>Manage your Shuttle account and sign-in methods.</DialogDescription>
                </DialogHeader>
                <div className="grid h-full min-h-0 grid-rows-[auto_1fr] sm:grid-cols-[180px_1fr] sm:grid-rows-1">
                    <aside className="border-b bg-muted/30 p-4 sm:border-b-0 sm:border-r">
                        <h2 className="mb-3 px-2 text-base font-semibold">Settings</h2>
                        <nav className="flex gap-1 sm:flex-col" aria-label="Settings sections">
                            <Button
                                variant="ghost"
                                className={cn('justify-start', section === 'account' && 'bg-accent')}
                                aria-current={section === 'account' ? 'page' : undefined}
                                autoFocus={section === 'account'}
                                onClick={() => onSectionChange('account')}
                            >
                                <UserRoundIcon />
                                Account
                            </Button>
                            <Button
                                variant="ghost"
                                className={cn('justify-start', section === 'security' && 'bg-accent')}
                                aria-current={section === 'security' ? 'page' : undefined}
                                autoFocus={section === 'security'}
                                onClick={() => onSectionChange('security')}
                            >
                                <KeyRoundIcon />
                                Security
                            </Button>
                        </nav>
                    </aside>
                    <div className="min-h-0 overflow-y-auto p-6 sm:p-8">
                        {section === 'account' ? (
                            <AccountSection
                                configuration={configuration}
                                data={data}
                                onProfileChanged={onProfileChanged}
                            />
                        ) : (
                            <SecuritySection
                                configuration={configuration}
                                data={data}
                                onProfileChanged={onProfileChanged}
                            />
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function AccountSection({
    configuration,
    data,
    onProfileChanged,
}: Pick<AccountSettingsDialogProps, 'configuration' | 'data' | 'onProfileChanged'>) {
    const [error, setError] = useState<string>();
    const [isSubmitting, setSubmitting] = useState(false);
    const [isSendingVerification, setSendingVerification] = useState(false);

    const updateProfile = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const response = await authClient.updateUser({ name: String(form.get('name') ?? '').trim() });
        if (response.error) {
            setError(response.error.message || 'Unable to update your profile');
        } else {
            await onProfileChanged();
            toast.success('Profile updated');
        }
        setSubmitting(false);
    };

    const sendVerification = async () => {
        if (!data) {
            return;
        }
        setSendingVerification(true);
        const response = await authClient.sendVerificationEmail({
            callbackURL: window.location.href,
            email: data.user.email,
        });
        if (response.error) {
            toast.error(response.error.message || 'Unable to send verification email');
        } else {
            toast.success('Verification email sent');
        }
        setSendingVerification(false);
    };

    return (
        <div>
            <h3 className="text-xl font-semibold">Account</h3>
            <p className="mt-1 text-sm text-muted-foreground">Manage your profile and email status.</p>

            <div className="mt-8 flex items-center gap-4">
                <Avatar className="size-14">
                    <AvatarImage src={data?.user.image ?? undefined} alt="" />
                    <AvatarFallback>{initials(data?.user.name ?? 'Shuttle user')}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <p className="truncate font-medium">{data?.user.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{data?.user.email}</p>
                </div>
            </div>

            <form className="mt-8" onSubmit={updateProfile}>
                <FieldGroup className="gap-5">
                    <Field>
                        <FieldLabel htmlFor="settings-name">Name</FieldLabel>
                        <Input
                            key={data?.user.name}
                            id="settings-name"
                            name="name"
                            autoComplete="name"
                            defaultValue={data?.user.name}
                            maxLength={100}
                            required
                        />
                    </Field>
                    <FieldError>{error}</FieldError>
                    <Button className="self-start" type="submit" disabled={isSubmitting || !data}>
                        {isSubmitting && <Spinner />}
                        Save
                    </Button>
                </FieldGroup>
            </form>

            <div className="mt-10 border-t pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="font-medium">Email</p>
                        <p className="mt-1 text-sm text-muted-foreground">{data?.user.email}</p>
                    </div>
                    {data?.user.emailVerified ? (
                        <Badge variant="secondary">Verified</Badge>
                    ) : (
                        <Button
                            variant="outline"
                            disabled={isSendingVerification || !configuration?.smtpConfigured}
                            onClick={() => void sendVerification()}
                        >
                            {isSendingVerification && <Spinner />}
                            Verify email
                        </Button>
                    )}
                </div>
                {!data?.user.emailVerified && !configuration?.smtpConfigured && (
                    <p className="mt-3 text-sm text-muted-foreground">
                        Email verification is unavailable because SMTP is not configured on this Relay.
                    </p>
                )}
            </div>
        </div>
    );
}

function SecuritySection({
    configuration,
    data,
    onProfileChanged,
}: Pick<AccountSettingsDialogProps, 'configuration' | 'data' | 'onProfileChanged'>) {
    const [error, setError] = useState<string>();
    const [isSubmitting, setSubmitting] = useState(false);
    const [isConnectingGitHub, setConnectingGitHub] = useState(false);
    const emailPasswordEnabled = configuration?.authProviders.includes('email-password');
    const githubEnabled = configuration?.authProviders.includes('github');

    const updatePassword = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const newPassword = String(form.get('newPassword') ?? '');
        const confirmation = String(form.get('confirmation') ?? '');
        if (newPassword !== confirmation) {
            setError('Passwords do not match');
            return;
        }

        setError(undefined);
        setSubmitting(true);
        try {
            if (data?.hasPassword) {
                const response = await authClient.changePassword({
                    currentPassword: String(form.get('currentPassword') ?? ''),
                    newPassword,
                    revokeOtherSessions: true,
                });
                if (response.error) {
                    throw new Error(response.error.message || 'Unable to change your password');
                }
            } else {
                await setInitialPassword(newPassword);
                await onProfileChanged();
            }
            formElement.reset();
            toast.success(data?.hasPassword ? 'Password changed' : 'Password set');
        } catch (passwordError) {
            setError(passwordError instanceof Error ? passwordError.message : 'Unable to update your password');
        } finally {
            setSubmitting(false);
        }
    };

    const connectGitHub = async () => {
        setConnectingGitHub(true);
        const response = await authClient.linkSocial({
            callbackURL: window.location.href,
            provider: 'github',
        });
        if (response.error) {
            toast.error(response.error.message || 'Unable to connect GitHub');
            setConnectingGitHub(false);
        }
    };

    return (
        <div>
            <h3 className="text-xl font-semibold">Security</h3>
            <p className="mt-1 text-sm text-muted-foreground">Manage your password and connected login methods.</p>

            {emailPasswordEnabled && (
                <section className="mt-8">
                    <div className="mb-5">
                        <h4 className="font-medium">Password</h4>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {data?.hasPassword
                                ? 'Changing it signs out your other browser sessions.'
                                : 'Set a password so you can sign in without waiting for email.'}
                        </p>
                    </div>
                    {!data?.hasPassword && (
                        <Alert className="mb-5">
                            <CircleAlertIcon />
                            <AlertTitle>No password set</AlertTitle>
                            <AlertDescription>Your current sign-in methods continue to work.</AlertDescription>
                        </Alert>
                    )}
                    <form onSubmit={updatePassword}>
                        <FieldGroup className="gap-5">
                            {data?.hasPassword && (
                                <Field>
                                    <FieldLabel htmlFor="settings-current-password">Current password</FieldLabel>
                                    <Input
                                        id="settings-current-password"
                                        name="currentPassword"
                                        type="password"
                                        autoComplete="current-password"
                                        minLength={8}
                                        required
                                    />
                                </Field>
                            )}
                            <Field>
                                <FieldLabel htmlFor="settings-new-password">
                                    {data?.hasPassword ? 'New password' : 'Password'}
                                </FieldLabel>
                                <Input
                                    id="settings-new-password"
                                    name="newPassword"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={8}
                                    required
                                />
                                <FieldDescription>Use at least 8 characters.</FieldDescription>
                            </Field>
                            <Field>
                                <FieldLabel htmlFor="settings-confirm-password">Confirm password</FieldLabel>
                                <Input
                                    id="settings-confirm-password"
                                    name="confirmation"
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={8}
                                    required
                                />
                            </Field>
                            <FieldError>{error}</FieldError>
                            <Button className="self-start" type="submit" disabled={isSubmitting || !data}>
                                {isSubmitting && <Spinner />}
                                {data?.hasPassword ? 'Change password' : 'Set password'}
                            </Button>
                        </FieldGroup>
                    </form>
                </section>
            )}

            {githubEnabled && (
                <section className={cn('mt-10 border-t pt-6', !emailPasswordEnabled && 'mt-8 border-t-0 pt-0')}>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="grid size-10 place-items-center rounded-xl border">
                                <LinkIcon className="size-5" />
                            </div>
                            <div>
                                <p className="font-medium">GitHub</p>
                                <p className="text-sm text-muted-foreground">
                                    {data?.githubConnected ? 'Connected to this account' : 'Use GitHub to sign in'}
                                </p>
                            </div>
                        </div>
                        {data?.githubConnected ? (
                            <Badge variant="secondary">Connected</Badge>
                        ) : (
                            <Button
                                variant="outline"
                                disabled={isConnectingGitHub}
                                onClick={() => void connectGitHub()}
                            >
                                {isConnectingGitHub && <Spinner />}
                                Connect
                            </Button>
                        )}
                    </div>
                </section>
            )}
        </div>
    );
}
