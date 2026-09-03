import { motion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { passwordChecks, passwordPassedCount } from '../../lib/passwordRules';

/**
 * Barre de force + liste des règles. Même barème que la page d'inscription
 * et que `passwordSchema` côté serveur. Ne rend rien tant que le champ est vide.
 */
export default function PasswordStrength({ password }: { password: string }) {
  const { t } = useTranslation();
  if (!password) return null;

  const checks = passwordChecks(password);
  const passed = passwordPassedCount(checks);
  const label = passed <= 2 ? t.register.strengthWeak : passed <= 4 ? t.register.strengthMedium : t.register.strengthStrong;
  const color = passed <= 2 ? 'bg-red-400' : passed <= 4 ? 'bg-yellow-400' : 'bg-green-400';

  const Regle = ({ ok, texte }: { ok: boolean; texte: string }) => (
    <div className="flex items-center gap-1.5">
      {ok ? <Check size={12} className="text-green-500" /> : <X size={12} className="text-gray-300" />}
      <span className={cn('text-[11px]', ok ? 'text-green-600' : 'text-gray-400')}>{texte}</span>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${(passed / 5) * 100}%` }} />
        </div>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Regle ok={checks.length} texte={t.register.min10Chars} />
        <Regle ok={checks.uppercase} texte={t.register.uppercase} />
        <Regle ok={checks.lowercase} texte={t.register.lowercase} />
        <Regle ok={checks.number} texte={t.register.number} />
        <Regle ok={checks.special} texte={t.register.specialChar} />
      </div>
    </motion.div>
  );
}
