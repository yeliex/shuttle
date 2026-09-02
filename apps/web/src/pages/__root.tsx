import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Toaster } from '@/ui/sonner';

export const Route = createRootRoute({
    component: () => (
        <>
            <Outlet />
            <Toaster position="bottom-right" richColors />
        </>
    ),
});
