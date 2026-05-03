import { redirect } from 'next/navigation';

export default function FollowsLegacyPage() {
  redirect('/discover?tab=follows');
}
