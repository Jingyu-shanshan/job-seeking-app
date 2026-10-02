import type { FactStatus } from '@jsa/shared';

export interface VersionState {
  version: number;
  body: string;
  status: FactStatus;
  maySendToModel: boolean;
  mayUseInMaterials: boolean;
}

export function currentVersion<V extends { version: number }>(versions: readonly V[]): V {
  const [first, ...rest] = versions;
  if (!first) throw new Error('a fact has at least one version');
  return rest.reduce((latest, v) => (v.version > latest.version ? v : latest), first);
}

const allowedChanges: Record<FactStatus, readonly FactStatus[]> = {
  proposed: ['confirmed', 'retired'],
  confirmed: ['retired'],
  retired: ['confirmed'],
};

export function statusChangeAllowed(from: FactStatus, to: FactStatus): boolean {
  return from === to || allowedChanges[from].includes(to);
}

const email = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u;
const phoneCandidates = /\+?\(?\d[\d\s().-]{6,}\d/g;

export function sensitiveData(text: string): string[] {
  const found: string[] = [];
  if (email.test(text)) found.push('an email address');
  const phone = [...text.matchAll(phoneCandidates)].some(([candidate]) => {
    const digits = candidate.replace(/\D/g, '').length;
    return candidate.startsWith('+') ? digits >= 8 : digits >= 9;
  });
  if (phone) found.push('a phone number');
  return found;
}

export function mayUse(fact: readonly VersionState[], purpose: 'model' | 'materials'): boolean {
  const current = currentVersion(fact);
  if (current.status !== 'confirmed') return false;
  if (purpose === 'materials') return current.mayUseInMaterials;
  return current.maySendToModel && sensitiveData(current.body).length === 0;
}
