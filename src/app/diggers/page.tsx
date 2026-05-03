import { redirect } from 'next/navigation';

export default function DiggersLegacyPage() {
  redirect('/discover?tab=curators');
}
