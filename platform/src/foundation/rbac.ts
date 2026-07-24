import type { WorkspaceRole } from '../contracts/domain';

export type Permission =
  | 'workspace:manage'
  | 'workflow:edit'
  | 'workflow:run'
  | 'approval:decide'
  | 'connection:manage'
  | 'billing:view';

const permissions: Readonly<Record<WorkspaceRole, readonly Permission[]>> = {
  owner: ['workspace:manage', 'workflow:edit', 'workflow:run', 'approval:decide', 'connection:manage', 'billing:view'],
  admin: ['workspace:manage', 'workflow:edit', 'workflow:run', 'approval:decide', 'connection:manage', 'billing:view'],
  editor: ['workflow:edit', 'workflow:run'],
  approver: ['approval:decide', 'workflow:run'],
  viewer: ['billing:view'],
};

export function can(role: WorkspaceRole, permission: Permission): boolean {
  return permissions[role].includes(permission);
}

export function requirePermission(role: WorkspaceRole, permission: Permission): void {
  if (!can(role, permission)) throw new Error(`Forbidden: ${role} lacks ${permission}`);
}
