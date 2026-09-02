import { type Static, Type } from 'typebox';

export const SharePermission = Type.Union([
    Type.Literal('read'),
    Type.Literal('message'),
]);

export type SharePermission = Static<typeof SharePermission>;

export const CompanionHello = Type.Object({
    deviceId: Type.String({ minLength: 1 }),
    companionVersion: Type.String({ minLength: 1 }),
    nodeVersion: Type.String({ minLength: 1 }),
});

export type CompanionHello = Static<typeof CompanionHello>;
