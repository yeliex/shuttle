import { Spinner } from '@/ui/spinner';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { AppShell } from '@/components/app-shell.tsx';
import { authClient } from '@/libs/auth.ts';

export const Route = createFileRoute('/_authenticated')({
    component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
    const session = authClient.useSession();

    useEffect(() => {
        if (!session.isPending && !session.data) {
            const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            const loginURL = new URL('login', `${window.location.origin}${import.meta.env.BASE_URL}`);
            loginURL.searchParams.set('redirect', current);
            window.location.replace(loginURL);
        }
    }, [session.data, session.isPending]);

    if (session.isPending || !session.data) {
        return (
            <main className="grid min-h-screen place-items-center" aria-label="Checking your session">
                <Spinner className="size-5" />
            </main>
        );
    }

    return <AppShell />;
}
