import { Alert, AlertDescription, AlertTitle } from '@/ui/alert';
import { Button } from '@/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/ui/field';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from '@/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Spinner } from '@/ui/spinner';
import { toast } from '@/ui/sonner';
import { Toggle } from '@/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group';
import type { SharePermission } from '@shuttle/contracts';
import { CheckCircle2Icon, CopyIcon, LinkIcon, MailIcon, MonitorUpIcon, UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

import { createInvite, searchRecipients, type CreateInviteResult } from '@/libs/api.ts';

interface InviteValues {
    canPreview: boolean;
    emails: string[];
    expiresInHours: number | null;
    singleUse: boolean;
    permission: SharePermission;
}

export function InviteDialog({
    hasServices,
    onCreated,
    sharedThreadId,
    title,
}: {
    hasServices: boolean;
    onCreated: () => void;
    sharedThreadId: string;
    title: string;
}) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [recipientMode, setRecipientMode] = useState('link');
    const [singleUse, setSingleUse] = useState(false);
    const searchEmail = email.split(',').at(-1)?.trim() ?? '';
    const recipients = useSWR(open && recipientMode === 'people' && searchEmail.length >= 2 ? ['share-recipients', searchEmail] : null,
        ([, query]) => searchRecipients(query));
    const [canPreview, setCanPreview] = useState(false);
    const [expiresInHours, setExpiresInHours] = useState(24);
    const [permission, setPermission] = useState<SharePermission>('read');
    const [result, setResult] = useState<CreateInviteResult>();
    const { error, isMutating, trigger } = useSWRMutation(
        ['create-invite', sharedThreadId],
        (_key, { arg }: { arg: InviteValues }) => createInvite(sharedThreadId, arg),
    );

    const setDialogOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
            setResult(undefined);
        }
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const invite = await trigger({
            canPreview,
            emails: recipientMode === 'people' ? email.split(',').map((value) => value.trim()).filter(Boolean) : [],
            expiresInHours: expiresInHours === 0 ? null : expiresInHours,
            singleUse: recipientMode === 'link' && singleUse,
            permission,
        });
        setResult(invite);
        onCreated();
        if (recipientMode === 'link') {
            await navigator.clipboard.writeText(invite.inviteURL);
            toast.success('Share link copied');
        }
    };

    const copyInvite = async () => {
        if (!result) {
            return;
        }
        await navigator.clipboard.writeText(result.inviteURL);
        toast.success('Invitation link copied');
    };

    return (
        <Dialog open={open} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
                <Button>
                    <UserPlusIcon data-icon="inline-start" />
                    Invite people
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Share “{title}”</DialogTitle>
                    <DialogDescription>
                        Invite someone to use this task from Codex through Shuttle tools.
                    </DialogDescription>
                </DialogHeader>

                {result ? (
                    <InviteResult
                        emailBound={recipientMode === 'people'}
                        result={result}
                        sharedThreadId={sharedThreadId}
                        onCopy={copyInvite}
                    />
                ) : (
                    <form id="invite-form" onSubmit={submit}>
                        <FieldGroup>
                            <Field>
                                <FieldLabel>Share with</FieldLabel>
                                <Select value={recipientMode} onValueChange={setRecipientMode}>
                                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="link">Anyone with this link</SelectItem>
                                        <SelectItem value="people">Selected people</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {recipientMode === 'people' ? <Field>
                                <FieldLabel htmlFor="invite-email">Email addresses</FieldLabel>
                                <InputGroup>
                                    <InputGroupInput
                                        id="invite-email"
                                        type="email"
                                        multiple
                                        required
                                        list="share-recipient-options"
                                        placeholder="teammate@example.com"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                    />
                                    <InputGroupAddon align="inline-end">
                                        <MailIcon />
                                    </InputGroupAddon>
                                </InputGroup>
                                <datalist id="share-recipient-options">
                                    {recipients.data?.users.map((user) => <option key={user.email} value={[...email.split(',').slice(0, -1), user.email].join(',')}>{user.name}</option>)}
                                </datalist>
                                <FieldDescription>
                                    Separate emails with commas. Verified recipients get access immediately, without accepting an invitation.
                                </FieldDescription>
                            </Field> : <Toggle variant="outline" pressed={singleUse} onPressedChange={setSingleUse}>Link can only be claimed once</Toggle>}

                            <Field>
                                <FieldLabel>Permission</FieldLabel>
                                <ToggleGroup
                                    type="single"
                                    value={permission}
                                    onValueChange={(value) => value && setPermission(value as SharePermission)}
                                    variant="outline"
                                    spacing={0}
                                    className="w-full"
                                >
                                    <ToggleGroupItem value="read" className="flex-1">Read</ToggleGroupItem>
                                    <ToggleGroupItem value="message" className="flex-1">Read & message</ToggleGroupItem>
                                </ToggleGroup>
                            </Field>

                            {hasServices && (
                                <Field>
                                    <FieldLabel>Local services</FieldLabel>
                                    <Toggle
                                        variant="outline"
                                        pressed={canPreview}
                                        onPressedChange={setCanPreview}
                                        className="w-full justify-start"
                                    >
                                        <MonitorUpIcon data-icon="inline-start" />
                                        Allow access to included services
                                    </Toggle>
                                    <FieldDescription>
                                        Service access follows this invitation and can be changed per person later.
                                    </FieldDescription>
                                </Field>
                            )}

                            <Field>
                                <FieldLabel>Access expires</FieldLabel>
                                <Select
                                    value={String(expiresInHours)}
                                    onValueChange={(value) => setExpiresInHours(Number(value))}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="24">In 24 hours</SelectItem>
                                        <SelectItem value="168">In 7 days</SelectItem>
                                        <SelectItem value="720">In 30 days</SelectItem>
                                        <SelectItem value="0">Never</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                        </FieldGroup>
                    </form>
                )}

                {error && <p className="text-sm text-destructive">{error.message}</p>}
                <DialogFooter>
                    {result ? (
                        <Button onClick={() => setDialogOpen(false)}>Done</Button>
                    ) : (
                        <Button form="invite-form" type="submit" disabled={isMutating}>
                            {isMutating && <Spinner />}
                            {recipientMode === 'link' ? 'Copy share link' : 'Send invitations'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function InviteResult({
    emailBound,
    onCopy,
    result,
    sharedThreadId,
}: {
    emailBound: boolean;
    onCopy: () => void;
    result: CreateInviteResult;
    sharedThreadId: string;
}) {
    const delivery = {
        failed: ['Email could not be sent', 'The invitation is ready; copy the link below instead.'],
        'not-configured': ['Email is not configured', 'The invitation is ready; send the link manually.'],
        'not-requested': ['Share link created', 'Recipients must sign in. Any usage limit and authorization deadline apply to this share.'],
        sent: ['Invitation email sent', 'A copyable link is also available below.'],
    }[result.emailDelivery];
    const usagePrompt = `Open this Shuttle shared task and sign in with your invited email:
${result.inviteURL}

Then use the Shuttle skill in a new Codex task to read:
shuttle://shared/${sharedThreadId}

If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. To send feedback, use Shuttle's send_shared_message tool for the same shared task.`;

    const copyPrompt = async () => {
        await navigator.clipboard.writeText(usagePrompt);
        toast.success('Message copied');
    };

    return (
        <div className="grid gap-5">
            <Alert>
                {result.emailDelivery === 'sent' ? <CheckCircle2Icon /> : <LinkIcon />}
                <AlertTitle>{delivery[0]}</AlertTitle>
                <AlertDescription>{delivery[1]}</AlertDescription>
            </Alert>
            <Field>
                <FieldLabel>Invitation link</FieldLabel>
                <InputGroup>
                    <InputGroupInput readOnly value={result.inviteURL} />
                    <InputGroupButton aria-label="Copy invitation link" onClick={onCopy}>
                        <CopyIcon />
                        Copy
                    </InputGroupButton>
                </InputGroup>
            </Field>
            {emailBound && (
                <Field>
                    <div className="flex items-center justify-between gap-3">
                        <FieldLabel>Message for your collaborator</FieldLabel>
                        <Button type="button" variant="outline" size="sm" onClick={copyPrompt}>
                            <CopyIcon />
                            Copy prompt
                        </Button>
                    </div>
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-4 font-mono text-xs leading-5 text-muted-foreground">
                        {usagePrompt}
                    </pre>
                </Field>
            )}
        </div>
    );
}
