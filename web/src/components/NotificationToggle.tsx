import { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { notificationsEnabled, setNotificationsEnabled } from '../lib/notifications';

type PermState = 'default' | 'granted' | 'denied';

function getPermState(): PermState {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission as PermState;
}

export default function NotificationToggle() {
  const [perm, setPerm] = useState<PermState>(getPermState);
  const [enabled, setEnabled] = useState(() => notificationsEnabled());

  const handleClick = async () => {
    if (perm === 'denied') return;

    if (perm === 'default') {
      const result = await Notification.requestPermission();
      setPerm(result as PermState);
      if (result === 'granted') {
        setNotificationsEnabled(true);
        setEnabled(true);
      }
      return;
    }

    // granted — toggle on/off
    const next = !enabled;
    setEnabled(next);
    setNotificationsEnabled(next);
  };

  const title =
    perm === 'denied'  ? 'Notifications blocked by browser' :
    perm === 'default' ? 'Enable notifications' :
    enabled            ? 'Notifications on — click to disable' :
                         'Notifications off — click to enable';

  return (
    <button
      className={`btn btn-ghost btn-sm ${perm === 'denied' ? 'opacity-30 cursor-not-allowed' : ''}`}
      onClick={handleClick}
      title={title}
      disabled={perm === 'denied'}
    >
      {perm === 'granted' && enabled
        ? <Bell size={16} className="text-primary" />
        : <BellOff size={16} />
      }
    </button>
  );
}
