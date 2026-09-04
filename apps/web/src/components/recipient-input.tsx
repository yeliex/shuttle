import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/ui/input-group';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';
import { Spinner } from '@/ui/spinner';
import { PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import useSWR from 'swr';

import { searchRecipients } from '@/libs/api.ts';

export function RecipientInput({ emails, onChange, draft, onDraftChange, disabled }: {
    emails: string[];
    onChange: (emails: string[]) => void;
    draft: string;
    onDraftChange: (draft: string) => void;
    disabled: boolean;
}) {
    const listID = useId();
    const input = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(-1);
    const normalized = draft.trim().toLowerCase();
    useEffect(() => {
        const timer = setTimeout(() => setQuery(normalized), 200);
        return () => clearTimeout(timer);
    }, [normalized]);
    const candidates = useSWR(query.length >= 2 && !disabled ? ['share-recipients', query] : null,
        ([, search]) => searchRecipients(search));
    const users = query === normalized ? (candidates.data?.users ?? []).filter((user) => !emails.includes(user.email)) : [];
    const open = focused && !dismissed && users.length > 0;
    const searching = normalized.length >= 2 && (query !== normalized || candidates.isLoading);
    const drafts = draft.split(/[\s,;]+/u).filter(Boolean).map((email) => email.toLowerCase());
    const valid = drafts.length > 0 && drafts.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email));
    const add = (additions: string[]) => {
        onChange([...new Set([...emails, ...additions])].sort());
        onDraftChange('');
        setActive(-1);
        input.current?.focus();
    };
    return (
        <Field>
            <FieldLabel htmlFor={listID + '-input'}>People</FieldLabel>
            {emails.length > 0 && <div className="flex max-h-28 flex-wrap gap-2 overflow-auto">
                {emails.map((email) => <Badge key={email} variant="secondary">
                    <span className="max-w-64 truncate">{email}</span>
                    <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove ${email}`}
                        onClick={() => onChange(emails.filter((value) => value !== email))}><XIcon /></Button>
                </Badge>)}
            </div>}
            <Popover open={open} onOpenChange={(value) => { if (!value) setDismissed(true); }}>
                <PopoverAnchor asChild>
                    <InputGroup>
                        <InputGroupInput ref={input} id={listID + '-input'} role="combobox" aria-expanded={open}
                            aria-controls={open ? listID : undefined} aria-autocomplete="list" autoComplete="off"
                            aria-activedescendant={open && users[active] ? `${listID}-${active}` : undefined}
                            placeholder="Search name or email, or enter a new email" value={draft} disabled={disabled}
                            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                            onChange={(event) => { onDraftChange(event.target.value); setDismissed(false); setActive(-1); }}
                            onKeyDown={(event) => {
                                if (event.nativeEvent.isComposing) return;
                                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                                    event.preventDefault(); setDismissed(false);
                                    setActive(Math.max(0, Math.min(users.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
                                } else if (event.key === 'Enter') {
                                    event.preventDefault();
                                    const user = open ? users[active] : undefined;
                                    if (user) add([user.email]); else if (valid) add(drafts);
                                } else if (event.key === 'Escape' && open) {
                                    event.preventDefault(); event.stopPropagation(); setDismissed(true);
                                }
                            }} />
                        <InputGroupAddon align="inline-end">
                            {searching ? <Spinner aria-label="Searching people" /> : valid && (
                                <InputGroupButton size="icon-xs" aria-label="Add email" onClick={() => add(drafts)} disabled={disabled}><PlusIcon /></InputGroupButton>
                            )}
                        </InputGroupAddon>
                    </InputGroup>
                </PopoverAnchor>
                <PopoverContent align="start" className="max-h-64 w-(--radix-popover-trigger-width) gap-1 overflow-auto p-1"
                    onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
                    onInteractOutside={(event) => { if (event.target === input.current) event.preventDefault(); }}>
                    <div role="listbox" id={listID} aria-label="Matching people">
                        {users.map((user, index) => <Button key={user.email} id={`${listID}-${index}`} type="button"
                            role="option" aria-selected={index === active} variant={index === active ? 'secondary' : 'ghost'}
                            className="h-auto w-full justify-start py-2" tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()} onClick={() => add([user.email])}>
                            <span className="flex min-w-0 flex-col items-start gap-1"><span>{user.name}</span><span className="max-w-full truncate text-xs text-muted-foreground">{user.email}</span></span>
                        </Button>)}
                    </div>
                </PopoverContent>
            </Popover>
            <FieldDescription>Choose existing people by name or email, or add new email addresses with Enter. Email recipients do not need to accept an invitation.</FieldDescription>
            {candidates.error && <FieldDescription>Search is unavailable. You can still enter full email addresses.</FieldDescription>}
        </Field>
    );
}
