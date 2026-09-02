import { Button } from '@/ui/button';
import {
    Field,
    FieldDescription,
    FieldError,
    FieldGroup,
    FieldLabel,
    FieldSeparator,
} from '@/ui/field';
import { Input } from '@/ui/input';
import { ShuttleLogo } from '@/ui/shuttle-logo';
import { Spinner } from '@/ui/spinner';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowLeftIcon, MailCheckIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { identifyAccount, type ConfigResponse } from '@/libs/api.ts';
import { authClient } from '@/libs/auth.ts';
import { safeRedirect } from '@/libs/format.ts';

export const Route = createFileRoute('/login/')({
    validateSearch: (search: Record<string, unknown>) => ({
        redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    }),
    component: Login,
});

type EmailStep = 'email' | 'password' | 'sent';

function Login() {
    const search = Route.useSearch();
    const redirect = safeRedirect(search.redirect ?? null);
    const session = authClient.useSession();
    const { data: configuration, error: configurationError } = useSWR<ConfigResponse>('/api/config');
    const [email, setEmail] = useState('');
    const [step, setStep] = useState<EmailStep>('email');
    const [error, setError] = useState<string>();
    const [isSubmitting, setSubmitting] = useState(false);
    const destination = `${redirect ?? import.meta.env.BASE_URL}${window.location.hash}`;

    useEffect(() => {
        if (session.data) {
            window.location.replace(destination);
        }
    }, [destination, session.data]);

    const submitEmail = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const address = String(form.get('email') ?? '').trim().toLowerCase();
        setEmail(address);

        try {
            const result = await identifyAccount(address);
            if (result.next === 'password') {
                setStep('password');
            } else if (result.next === 'magic-link') {
                if (window.location.hash) {
                    window.sessionStorage.setItem('shuttle:invite-token', window.location.hash.slice(1));
                }
                const response = await authClient.signIn.magicLink({
                    callbackURL: new URL(destination, window.location.origin).toString(),
                    email: address,
                    errorCallbackURL: new URL(
                        `${import.meta.env.BASE_URL}login`,
                        window.location.origin,
                    ).toString(),
                    name: address.split('@', 1)[0],
                });
                if (response.error) {
                    throw new Error(response.error.message || 'Unable to send a sign-in link');
                }
                setStep('sent');
            } else {
                setError('This email cannot sign in to this Shuttle Relay.');
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Unable to continue');
        } finally {
            setSubmitting(false);
        }
    };

    const submitPassword = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setSubmitting(true);
        const form = new FormData(event.currentTarget);
        const response = await authClient.signIn.email({
            email,
            password: String(form.get('password') ?? ''),
            rememberMe: true,
        });
        setSubmitting(false);

        if (response.error) {
            setError(response.error.message || 'Unable to sign in');
            return;
        }
        window.location.assign(destination);
    };

    const resendMagicLink = async () => {
        setError(undefined);
        setSubmitting(true);
        try {
            const response = await authClient.signIn.magicLink({
                callbackURL: new URL(destination, window.location.origin).toString(),
                email,
                errorCallbackURL: new URL(
                    `${import.meta.env.BASE_URL}login`,
                    window.location.origin,
                ).toString(),
                name: email.split('@', 1)[0],
            });
            if (response.error) {
                throw new Error(response.error.message || 'Unable to resend the link');
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Unable to resend the link');
        } finally {
            setSubmitting(false);
        }
    };

    const signInWithGitHub = async () => {
        setError(undefined);
        setSubmitting(true);
        if (window.location.hash) {
            window.sessionStorage.setItem('shuttle:invite-token', window.location.hash.slice(1));
        }
        const callbackURL = new URL(redirect ?? import.meta.env.BASE_URL, window.location.origin).toString();
        const response = await authClient.signIn.social({ callbackURL, provider: 'github' });
        if (response.error) {
            setError(response.error.message || 'Unable to sign in with GitHub');
            setSubmitting(false);
        }
    };

    const emailEnabled = configuration?.authProviders.includes('email-password');
    const githubEnabled = configuration?.authProviders.includes('github');

    return (
        <main className="relative grid min-h-screen place-items-center px-5 py-12">
            <a href={import.meta.env.BASE_URL} className="absolute left-6 top-6">
                <ShuttleLogo />
            </a>
            <section className="w-full max-w-md">
                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-semibold tracking-tight">
                        {step === 'sent' ? 'Check your email' : 'Welcome to Shuttle'}
                    </h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {step === 'sent'
                            ? `We sent a one-time sign-in link to ${email}.`
                            : 'Sign in to access your shared Codex tasks.'}
                    </p>
                </div>

                {configurationError ? (
                    <p className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
                        Cannot load this Relay’s login configuration.
                    </p>
                ) : !configuration ? (
                    <div className="grid h-48 place-items-center"><Spinner className="size-5" /></div>
                ) : step === 'sent' ? (
                    <FieldGroup>
                        <div className="mx-auto grid size-14 place-items-center rounded-full bg-secondary">
                            <MailCheckIcon className="size-6" />
                        </div>
                        <FieldError className="text-center">{error}</FieldError>
                        <Button size="lg" variant="outline" onClick={() => void resendMagicLink()} disabled={isSubmitting}>
                            {isSubmitting && <Spinner />}
                            Resend link
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setStep('email');
                                setError(undefined);
                            }}
                        >
                            <ArrowLeftIcon />
                            Use a different email
                        </Button>
                    </FieldGroup>
                ) : (
                    <FieldGroup>
                        {githubEnabled && step === 'email' && (
                            <Button variant="outline" size="lg" onClick={signInWithGitHub} disabled={isSubmitting}>
                                {isSubmitting && <Spinner />}
                                Continue with GitHub
                            </Button>
                        )}

                        {githubEnabled && emailEnabled && step === 'email' && (
                            <FieldSeparator>or continue with email</FieldSeparator>
                        )}

                        {emailEnabled && step === 'email' && (
                            <form onSubmit={submitEmail} className="grid gap-5">
                                <Field>
                                    <FieldLabel htmlFor="email">Email</FieldLabel>
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        autoComplete="email"
                                        defaultValue={email}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <FieldError>{error}</FieldError>
                                <Button type="submit" size="lg" disabled={isSubmitting}>
                                    {isSubmitting && <Spinner />}
                                    Continue
                                </Button>
                            </form>
                        )}

                        {emailEnabled && step === 'password' && (
                            <form onSubmit={submitPassword} className="grid gap-5">
                                <Field>
                                    <FieldLabel htmlFor="email">Email</FieldLabel>
                                    <Input id="email" value={email} readOnly />
                                </Field>
                                <Field>
                                    <FieldLabel htmlFor="password">Password</FieldLabel>
                                    <Input
                                        id="password"
                                        name="password"
                                        type="password"
                                        autoComplete="current-password"
                                        minLength={8}
                                        autoFocus
                                        required
                                    />
                                </Field>
                                <FieldError>{error}</FieldError>
                                <Button type="submit" size="lg" disabled={isSubmitting}>
                                    {isSubmitting && <Spinner />}
                                    Sign in
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setStep('email');
                                        setError(undefined);
                                    }}
                                >
                                    <ArrowLeftIcon />
                                    Use a different email
                                </Button>
                            </form>
                        )}

                        {!configuration.openRegistration && step === 'email' && (
                            <Field className="items-center text-center">
                                <FieldDescription>
                                    New accounts are managed by this Relay’s administrator.
                                </FieldDescription>
                            </Field>
                        )}
                    </FieldGroup>
                )}

                <nav className="mt-10 flex items-center justify-center text-xs text-muted-foreground" aria-label="Documentation">
                    <a className="hover:text-foreground" href="/docs">Documentation</a>
                </nav>
            </section>
        </main>
    );
}
