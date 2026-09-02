import { Button } from '@/ui/button';
import { Spinner } from '@/ui/spinner';
import { toast } from '@/ui/sonner';
import { ExternalLinkIcon } from 'lucide-react';
import useSWRMutation from 'swr/mutation';

import { openPreviewSession } from '@/libs/api.ts';

export function OpenPreviewButton({
    disabled = false,
    service,
}: {
    disabled?: boolean;
    service: { id: string; name: string };
}) {
    const opening = useSWRMutation(
        ['open-preview', service.id],
        () => openPreviewSession(service.id),
    );
    const openPreview = async () => {
        const tab = window.open('about:blank', '_blank');
        try {
            const session = await opening.trigger();
            if (tab) {
                tab.location.assign(session.previewURL);
            } else {
                window.location.assign(session.previewURL);
            }
        } catch (error) {
            tab?.close();
            toast.error(error instanceof Error ? error.message : 'Service could not be opened');
        }
    };

    return (
        <Button
            variant="ghost"
            size="icon-sm"
            title={`Open ${service.name}`}
            aria-label={`Open ${service.name}`}
            onClick={(event) => {
                event.stopPropagation();
                void openPreview();
            }}
            disabled={disabled || opening.isMutating}
        >
            {opening.isMutating ? <Spinner /> : <ExternalLinkIcon />}
        </Button>
    );
}
