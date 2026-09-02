import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { ShuttleLogo } from '@/ui/shuttle-logo';
import { cn } from '@/ui/libs/utils';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
    KeyRoundIcon,
    LaptopIcon,
    LogOutIcon,
    MenuIcon,
    MessagesSquareIcon,
    RadioTowerIcon,
    SettingsIcon,
    ShieldCheckIcon,
} from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

import { AccountSettingsDialog } from '@/components/account-settings-dialog.tsx';
import { authClient } from '@/libs/auth.ts';
import type { ConfigResponse, MeResponse, User } from '@/libs/api.ts';
import { initials } from '@/libs/format.ts';

const navigation = [
    { adminOnly: false, href: '/', icon: MessagesSquareIcon, label: 'Shared tasks' },
    { adminOnly: false, href: '/devices', icon: LaptopIcon, label: 'Devices' },
    { adminOnly: false, href: '/services', icon: RadioTowerIcon, label: 'Services' },
    { adminOnly: true, href: '/admin', icon: ShieldCheckIcon, label: 'Relay admin' },
] as const;

export function AppShell() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const { data, mutate } = useSWR<MeResponse>('/api/me');
    const { data: configuration } = useSWR<ConfigResponse>('/api/config');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsSection, setSettingsSection] = useState<'account' | 'security'>('account');
    const visibleNavigation = navigation.filter((item) => !item.adminOnly || data?.isAdmin);

    const signOut = async () => {
        await authClient.signOut();
        window.location.assign(`${import.meta.env.BASE_URL}login`);
    };

    return (
        <div className="min-h-screen bg-background text-foreground">
            <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 border-r bg-sidebar px-3 py-5 md:flex md:flex-col">
                <Link to="/" search={{}} className="mb-8 px-3">
                    <ShuttleLogo />
                </Link>
                <nav className="flex flex-1 flex-col gap-1" aria-label="Main navigation">
                    {visibleNavigation.map(({ href, icon: Icon, label }) => {
                        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                        return (
                            <Link
                                key={href}
                                to={href}
                                search={{}}
                                className={cn(
                                    'flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                    active && 'bg-sidebar-accent text-sidebar-accent-foreground',
                                )}
                            >
                                <Icon className="size-4" />
                                {label}
                            </Link>
                        );
                    })}
                </nav>
                <AccountMenu
                    user={data?.user}
                    onOpenSettings={() => {
                        setSettingsSection('account');
                        setSettingsOpen(true);
                    }}
                    onSignOut={signOut}
                />
            </aside>

            <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
                <ShuttleLogo />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Open navigation">
                            <MenuIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        {visibleNavigation.map(({ href, icon: Icon, label }) => (
                            <DropdownMenuItem key={href} asChild>
                                <Link to={href} search={{}}>
                                    <Icon />
                                    {label}
                                </Link>
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => {
                            setSettingsSection('account');
                            setSettingsOpen(true);
                        }}>
                            <SettingsIcon />
                            Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={signOut}>
                            <LogOutIcon />
                            Sign out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>

            <main className="min-h-screen md:pl-60">
                {data
                    && !data.hasPassword
                    && configuration?.authProviders.includes('email-password') && (
                    <div className="mx-auto max-w-6xl px-5 pt-5 sm:px-8 lg:px-10">
                        <Alert>
                            <KeyRoundIcon />
                            <AlertTitle>Add a password</AlertTitle>
                            <AlertDescription>
                                Set one now so you can sign in without waiting for an email.
                            </AlertDescription>
                            <AlertAction>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        setSettingsSection('security');
                                        setSettingsOpen(true);
                                    }}
                                >
                                    Set password
                                </Button>
                            </AlertAction>
                        </Alert>
                    </div>
                )}
                <Outlet />
            </main>
            <AccountSettingsDialog
                configuration={configuration}
                data={data}
                onOpenChange={setSettingsOpen}
                onProfileChanged={() => mutate()}
                onSectionChange={setSettingsSection}
                open={settingsOpen}
                section={settingsSection}
            />
        </div>
    );
}

function AccountMenu({
    user,
    onOpenSettings,
    onSignOut,
}: {
    onOpenSettings: () => void;
    onSignOut: () => Promise<void>;
    user?: User;
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-auto justify-start gap-3 px-2 py-2">
                    <Avatar className="size-8">
                        <AvatarImage src={user?.image ?? undefined} alt="" />
                        <AvatarFallback>{initials(user?.name ?? 'Shuttle user')}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 text-left">
                        <span className="block truncate text-sm font-medium">{user?.name ?? 'Loading…'}</span>
                        <span className="block max-w-36 truncate text-xs font-normal text-muted-foreground">
                            {user?.email}
                        </span>
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onOpenSettings}>
                    <SettingsIcon />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
                    <LogOutIcon />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
