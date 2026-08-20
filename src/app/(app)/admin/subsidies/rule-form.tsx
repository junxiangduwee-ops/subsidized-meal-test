'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionForm } from '@/components/action-form';
import { Dialog } from '@/components/dialog';

import { createSubsidyRule, updateSubsidyRule } from './actions';

type RuleFields = {
  id: string;
  name: string;
  type: 'PERCENTAGE' | 'FIXED_PER_ITEM' | 'FIXED_PER_DAY';
  value: number;
  capSen: number | null;
  scope: 'ALL' | 'DEPARTMENT';
  department: string | null;
  priority: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

function Fields({ rule, departments }: { rule?: RuleFields; departments: string[] }) {
  const t = useTranslations('subsidiesAdmin');
  const [type, setType] = useState<RuleFields['type']>(rule?.type ?? 'FIXED_PER_ITEM');
  const [scope, setScope] = useState<RuleFields['scope']>(rule?.scope ?? 'ALL');

  const isPercent = type === 'PERCENTAGE';
  const valueDefault = rule
    ? rule.type === 'PERCENTAGE'
      ? String(rule.value)
      : (rule.value / 100).toFixed(2)
    : '';

  return (
    <>
      <div>
        <label className="label">{t('ruleName')}</label>
        <input
          name="name"
          required
          defaultValue={rule?.name}
          className="input"
          placeholder={t('ruleNamePlaceholder')}
        />
      </div>

      <div>
        <label className="label">{t('type')}</label>
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as RuleFields['type'])}
          className="input"
        >
          <option value="FIXED_PER_ITEM">{t('typeFixedPerItemOption')}</option>
          <option value="PERCENTAGE">{t('typePercentageOption')}</option>
          <option value="FIXED_PER_DAY">{t('typeDailyCapOption')}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{isPercent ? t('percentageLabel') : t('amountLabel')}</label>
          <input
            name="value"
            required
            inputMode="decimal"
            defaultValue={valueDefault}
            className="input"
            placeholder={isPercent ? '50' : '5.00'}
          />
        </div>
        <div>
          <label className="label">{t('perItemCap')}</label>
          <input
            name="cap"
            inputMode="decimal"
            defaultValue={rule?.capSen != null ? (rule.capSen / 100).toFixed(2) : ''}
            className="input"
            placeholder={t('optional')}
            disabled={type === 'FIXED_PER_DAY'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">{t('appliesTo')}</label>
          <select
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as RuleFields['scope'])}
            className="input"
          >
            <option value="ALL">{t('scopeAll')}</option>
            <option value="DEPARTMENT">{t('scopeDepartment')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('department')}</label>
          <input
            name="department"
            list="department-list"
            defaultValue={rule?.department ?? ''}
            className="input"
            disabled={scope === 'ALL'}
            placeholder={scope === 'ALL' ? '—' : 'Operations'}
          />
          <datalist id="department-list">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label">{t('priority')}</label>
          <input
            name="priority"
            inputMode="numeric"
            defaultValue={rule?.priority ?? 0}
            className="input"
          />
        </div>
        <div>
          <label className="label">{t('from')}</label>
          <input name="effectiveFrom" type="date" defaultValue={rule?.effectiveFrom ?? ''} className="input" />
        </div>
        <div>
          <label className="label">{t('to')}</label>
          <input name="effectiveTo" type="date" defaultValue={rule?.effectiveTo ?? ''} className="input" />
        </div>
      </div>

      <p className="text-xs text-slate-500">{t('priorityHint')}</p>
    </>
  );
}

export function AddRuleButton({ departments }: { departments: string[] }) {
  const t = useTranslations('subsidiesAdmin');
  return (
    <Dialog
      title={t('addARule')}
      trigger={(open) => (
        <button type="button" className="btn-primary" onClick={open}>
          {t('addRule')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={createSubsidyRule}
          submitLabel={t('createRule')}
          className="space-y-3"
          onSuccess={close}
        >
          <Fields departments={departments} />
        </ActionForm>
      )}
    </Dialog>
  );
}

export function EditRuleDialog({ rule, departments }: { rule: RuleFields; departments: string[] }) {
  const t = useTranslations('subsidiesAdmin');
  const c = useTranslations('adminCommon');
  return (
    <Dialog
      title={t('editRule', { name: rule.name })}
      trigger={(open) => (
        <button type="button" className="btn-secondary btn-sm" onClick={open}>
          {c('edit')}
        </button>
      )}
    >
      {(close) => (
        <ActionForm
          action={updateSubsidyRule}
          submitLabel={c('saveChanges')}
          resetOnSuccess={false}
          className="space-y-3"
          onSuccess={close}
        >
          <input type="hidden" name="id" value={rule.id} />
          <Fields rule={rule} departments={departments} />
        </ActionForm>
      )}
    </Dialog>
  );
}
