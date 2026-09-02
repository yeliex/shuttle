import { RouterProvider } from '@tanstack/react-router';
import { SWRProvider } from './libs/swr.tsx';
import { router } from './router.tsx';

const App = () => (
    <SWRProvider>
        <RouterProvider router={router} />
    </SWRProvider>
);

export default App;
