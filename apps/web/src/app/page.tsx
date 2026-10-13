import { redirect } from 'next/navigation';

// The pool chooser (guarded by the (app) layout) decides where the user lands.
export default function Home() {
  redirect('/pools');
}
