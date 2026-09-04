'use client';

import { useTranslations } from 'next-intl';

import { ActionForm } from '@/components/action-form';
import { Dialog } from '@/components/dialog';

import { createUser, resetPassword, updateUser } from './actions';

type UserFields = {
  id: string;
  name: string;
  email: string;
  staffId: string | null;
  department: string | null;
  role: 'ADMIN' | 'ANALYTICS' | 'FINANCE' | 'USER';
  authProvider: 'LOCAL' | 'LDAP' | 'OIDC';
};

function useRoleOptions() {
  const t = useTranslations('usersAdmin');
  return [
    { value: 'USER', label: t('roleUserOption') },
    { value: 'ADMIN', label: t('roleAdminOption') },
    { value: 'ANALYTICS', label: t('roleAnalyticsOption') },
    { value: 'FINANCE', label: t('roleFinanceOption') },
  ] as const;
}

function CreateUserFields({ departments }: { departments: string[] }) {
  const t = useTranslations('usersAdmin');
  const roleOptions = useRoleOptions();
  return (
    <>
      <div>
        <label className="label">{t('workEmail')}</label>
        <input name="email" type="email" required className="input" placeholder="name@mrdiy.com" />
      </div>
      <div>
        <label className="label">{t('fullName')}</label>
        <input name="name" required className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('staffId')}</label>
          <input name="staffId" className="input" placeholder={t('staffIdPlaceholder')} />
        </div>
        <div>
          <label className="label">{t('department')}</label>
          <input name="department" list="dept-list" className="input" />
          <datalist id="dept-list">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      </div>
      <div>
        <label className="label">{t('role_')}</label>
        <select name="role" defaultValue="USER" className="input">
          {roleOptions.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label">{t('temporaryPassword')}</label>
        <input name="password" type="password" required className="input" autoComplete="new-password" />
        <p className="mt-1 text-xs text-slate-500">{t('passwordHint')}</p>
      </div>
    </>
  );
}

export function AddUserButton({ departments }: { departments: string[] }) {
  const t = useTranslations('usersAdmin');
  return (
    <Dialog
      title={t('addAUser')}
      trigger={(open) => (
        <button type="button" className="btn-primary" onClick={open}>
          {t('addUser')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={createUser}
          submitLabel={t('createUser')}
          className="space-y-3"
          onSuccess={close}
        >
          <CreateUserFields departments={departments} />
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditUserDialog({ user, departments }: { user: UserFields; departments: string[] }) {
  const t = useTranslations('usersAdmin');
  const c = useTranslations('adminCommon');
  const roleOptions = useRoleOptions();
  return (
    <Dialog
      title={t('editUser', { name: user.name })}
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={updateUser}
          submitLabel={c('saveChanges')}
          resetOnSuccess={false}
          className="space-y-3"
          onSuccess={close}
        >
          <input type="hidden" name="id" value={user.id} />
          <div>
            <label className="label">{t('email')}</label>
            <input value={user.email} disabled className="input" />
            <p className="mt-1 text-xs text-slate-500">
              {t('signsInWith', {
                provider: user.authProvider === 'LOCAL' ? t('localPassword') : user.authProvider,
              })}
            </p>
          </div>
          <div>
            <label className="label">{t('fullName')}</label>
            <input name="name" required defaultValue={user.name} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('staffId')}</label>
              <input name="staffId" defaultValue={user.staffId ?? ''} className="input" />
            </div>
            <div>
              <label className="label">{t('department')}</label>
              <input name="department" list="dept-list-edit" defaultValue={user.department ?? ''} className="input" />
              <datalist id="dept-list-edit">
                {departments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
          </div>
          <div>
            <label className="label">{t('role_')}</label>
            <select name="role" defaultValue={user.role} className="input">
              {roleOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}

export function ResetPasswordDialog({ user }: { user: Pick<UserFields, 'id' | 'name'> }) {
  const t = useTranslations('usersAdmin');
  return (
    <Dialog
      title={t('resetPasswordFor', { name: user.name })}
      width="max-w-sm"
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {t('resetPassword')}
        </button>
      )}
    >
      {() => (
        <ActionForm action={resetPassword} submitLabel={t('reset')} resetOnSuccess={false} className="space-y-3">
          <input type="hidden" name="id" value={user.id} />
          <div>
            <label className="label">{t('newTemporaryPassword')}</label>
            <input name="password" type="password" required className="input" autoComplete="new-password" />
            <p className="mt-1 text-xs text-slate-500">{t('resetPasswordHint')}</p>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
