import { Alert, AlertDescription } from '@/ui/alert';
import { Button } from '@/ui/button';
import { Checkbox } from '@/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSet } from '@/ui/field';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import { Separator } from '@/ui/separator';
import { Spinner } from '@/ui/spinner';
import { toast } from '@/ui/sonner';
import type { SharePermission } from '@shuttle/contracts';
import { CopyIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import useSWRMutation from 'swr/mutation';

import { RecipientInput } from '@/components/recipient-input.tsx';
import { createInvite, type SharedThreadDetail, type SharedThreadSummary } from '@/libs/api.ts';
import { formatDate } from '@/libs/format.ts';

interface ShareSettings {
    recipientMode: string;
    emails: string[];
    canPreview: boolean;
    permission: SharePermission;
    lifetime: string;
    singleUse: boolean;
}

export function ShareSettingsForm({ detail, onSaved, onBusyChange, children }: {
    detail: SharedThreadDetail;
    onSaved: () => void;
    onBusyChange: (busy: boolean) => void;
    children: ReactNode;
}) {
    const invitation = detail.invites?.[0];
    const initial: ShareSettings = {
        recipientMode: invitation?.restricted ? 'people' : 'link',
        emails: invitation?.restricted ? (detail.grants ?? []).map((grant) => grant.email).sort() : [],
        canPreview: invitation?.canPreview ?? false,
        permission: invitation?.permission ?? 'read',
        lifetime: invitation ? 'keep' : '24',
        singleUse: invitation?.singleUse ?? false,
    };
    const [saved, setSaved] = useState(initial);
    const [values, setValues] = useState(initial);
    const [draft, setDraft] = useState('');
    const [inviteURL, setInviteURL] = useState(invitation?.inviteURL ?? undefined);
    const [deadline, setDeadline] = useState(detail.expiresAt);
    const [error, setError] = useState<string>();
    const [sent, setSent] = useState(false);
    const { isMutating, trigger } = useSWRMutation(
        ['share-settings', detail.id],
        (_key, { arg }: { arg: Parameters<typeof createInvite>[1] }) => createInvite(detail.id, arg),
    );
    const dirty = JSON.stringify(values) !== JSON.stringify(saved) || (values.recipientMode === 'people' && draft.trim() !== '');
    const expired = Boolean(deadline && new Date(deadline) <= new Date());

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (isMutating) return;
        const emails = values.recipientMode === 'people'
            ? [...new Set([...values.emails, ...draft.split(/[\s,;]+/u)].filter(Boolean).map((email) => email.toLowerCase()))].sort() : [];
        if (values.recipientMode === 'people' && (!emails.length || emails.length > 50
            || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)))) {
            setError('Select a person or enter complete email addresses (up to 50).');
            return;
        }
        setError(undefined);
        setSent(false);
        onBusyChange(true);
        try {
            const result = await trigger({
                emails, permission: values.permission,
                canPreview: detail.previewServices.length > 0 && values.canPreview,
                singleUse: values.recipientMode === 'link' && values.singleUse,
                ...(values.lifetime === 'keep' ? {} : { expiresInHours: values.lifetime === '0' ? null : Number(values.lifetime) }),
            });
            if (result.emailDelivery === 'failed' || result.emailDelivery === 'not-configured') {
                // 授权可能已经保存，邮件失败仍停留在原表单，由用户决定是否重试发送。
                setError(`Access was saved, but invitation delivery failed${result.failedEmails?.length ? ` for ${result.failedEmails.join(', ')}` : ''}. Retry to send again.`);
                onSaved();
                return;
            }
            const next = { ...values, emails, lifetime: 'keep' };
            setSaved(next);
            setValues(next);
            setDraft('');
            setInviteURL(result.inviteURL);
            setDeadline(result.invite.expiresAt);
            setSent(true);
            onSaved();
            toast.success(values.recipientMode === 'people' ? 'Invitations sent' : 'Share settings saved');
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Unable to save share settings. Try again.');
        } finally {
            onBusyChange(false);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            <fieldset disabled={isMutating}>{children}</fieldset>
            <form onSubmit={submit}>
                <FieldSet disabled={isMutating}>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor="share-audience">Share with</FieldLabel>
                            <Select value={values.recipientMode} disabled={isMutating} onValueChange={(recipientMode) => setValues({ ...values, recipientMode })}>
                                <SelectTrigger id="share-audience" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup>
                                    <SelectItem value="link">Anyone with this link</SelectItem>
                                    <SelectItem value="people">Selected people</SelectItem>
                                </SelectGroup></SelectContent>
                            </Select>
                        </Field>
                        {values.recipientMode === 'people' ? (
                            <RecipientInput emails={values.emails} draft={draft} onDraftChange={setDraft} disabled={isMutating}
                                onChange={(emails) => setValues({ ...values, emails })} />
                        ) : (
                            <Field orientation="horizontal">
                                <FieldLabel htmlFor="share-single-use">Link can only be claimed once</FieldLabel>
                                <Checkbox id="share-single-use" checked={values.singleUse} disabled={isMutating}
                                    onCheckedChange={(value) => setValues({ ...values, singleUse: value === true })} />
                            </Field>
                        )}
                        <Field>
                            <FieldLabel htmlFor="share-permission">Permission</FieldLabel>
                            <Select value={values.permission} disabled={isMutating} onValueChange={(permission) => setValues({ ...values, permission: permission as SharePermission })}>
                                <SelectTrigger id="share-permission" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup>
                                    <SelectItem value="read">Read only</SelectItem>
                                    <SelectItem value="message">Read & message</SelectItem>
                                </SelectGroup></SelectContent>
                            </Select>
                        </Field>
                        <Field>
                            <FieldLabel htmlFor="share-lifetime">Access expires</FieldLabel>
                            <Select value={values.lifetime} disabled={isMutating} onValueChange={(lifetime) => setValues({ ...values, lifetime })}>
                                <SelectTrigger id="share-lifetime" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent><SelectGroup>
                                    {inviteURL && <SelectItem value="keep">Keep current expiry</SelectItem>}
                                    <SelectItem value="24">In 1 day</SelectItem>
                                    <SelectItem value="168">In 7 days</SelectItem>
                                    <SelectItem value="720">In 30 days</SelectItem>
                                    <SelectItem value="0">Never</SelectItem>
                                </SelectGroup></SelectContent>
                            </Select>
                            <FieldDescription>{deadline ? `Current access ${expired ? 'expired' : 'expires'}: ${formatDate(deadline)}.` : 'Current access has no expiration.'}</FieldDescription>
                        </Field>
                        {detail.previewServices.length > 0 && <Field orientation="horizontal">
                            <FieldLabel htmlFor="share-services">Include local services</FieldLabel>
                            <Checkbox id="share-services" checked={values.canPreview} disabled={isMutating}
                                onCheckedChange={(value) => setValues({ ...values, canPreview: value === true })} />
                        </Field>}
                        <FieldDescription>
                            Saving applies these permissions to existing collaborators. Selected people replaces the authorized email list.
                            Choosing a new lifetime changes access for everyone; keeping the current expiry does not renew it.
                        </FieldDescription>
                        {error && <FieldError>{error}</FieldError>}
                        <div className="flex justify-end">
                            <Button type="submit" variant="outline" disabled={isMutating || (!dirty && Boolean(inviteURL) && !error)}>
                                {isMutating && <Spinner data-icon="inline-start" />}
                                {isMutating ? 'Saving…' : values.recipientMode === 'people' ? 'Send invitations' : 'Share'}
                            </Button>
                        </div>
                    </FieldGroup>
                </FieldSet>
            </form>
            <Separator />
            {(dirty || error || !inviteURL) && <p className="text-sm text-muted-foreground">Save successfully before copying the updated share.</p>}
            {sent && !dirty && <Alert><AlertDescription>Share ready. Send the link or prompt below to your collaborators.</AlertDescription></Alert>}
            <TaskReference thread={{ ...detail, permission: saved.permission }} inviteURL={inviteURL}
                disabled={dirty || isMutating || Boolean(error) || !inviteURL || expired} />
        </div>
    );
}

export function TaskReference({ thread, inviteURL, disabled = false }: {
    thread: SharedThreadSummary;
    inviteURL?: string | undefined;
    disabled?: boolean;
}) {
    const deepLink = `shuttle://shared/${thread.id}`;
    const prompt = `${inviteURL ? `Open this Shuttle shared task (sign in with your invited email if needed):\n${inviteURL}\n\n` : ''}Use the Shuttle skill in a new Codex task to read:
${deepLink}

If Shuttle is not initialized, first read https://shuttle.makesth.fun/Agents.md and follow the setup instructions. ${thread.permission === 'read' ? 'This share is read-only.' : "If you have message permission, use Shuttle's send_shared_message tool for the same shared task."}`;
    return (
        <section className="flex flex-col gap-4" aria-label="Share links and prompt">
            {[...(inviteURL ? [{ label: 'Share link', value: inviteURL }] : []), { label: 'Deep link', value: deepLink }].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{label}</h3>
                    <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
                        <code className="min-w-0 flex-1 text-xs [overflow-wrap:anywhere]">{value}</code>
                        <Button type="button" variant="outline" size="icon-sm" disabled={disabled} aria-label={`Copy ${label.toLowerCase()}`}
                            onClick={async () => {
                                try { await navigator.clipboard.writeText(value); toast.success(`${label} copied`); }
                                catch { toast.error('Unable to copy. Please try again.'); }
                            }}><CopyIcon /></Button>
                    </div>
                </div>
            ))}
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Prompt for your collaborator</h3>
                <div className="relative rounded-xl border bg-muted/40">
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 pb-14 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">{prompt}</pre>
                    <Button type="button" className="absolute right-2 bottom-2" variant="outline" size="icon-sm" disabled={disabled} aria-label="Copy prompt"
                        onClick={async () => {
                            try { await navigator.clipboard.writeText(prompt); toast.success('Prompt copied'); }
                            catch { toast.error('Unable to copy. Please try again.'); }
                        }}><CopyIcon /></Button>
                </div>
            </div>
        </section>
    );
}
