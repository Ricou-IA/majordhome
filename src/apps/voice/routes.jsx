import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';

const VoiceRecorder = lazy(() => import('./pages/VoiceRecorder'));

function VoiceLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary-900">
      <Loader2 className="w-8 h-8 text-white animate-spin" />
    </div>
  );
}

function SuspenseWrapper({ children }) {
  return <Suspense fallback={<VoiceLoader />}>{children}</Suspense>;
}

export const voiceRoutes = [
  {
    index: true,
    element: (
      <SuspenseWrapper>
        <VoiceRecorder />
      </SuspenseWrapper>
    ),
  },
];

export default voiceRoutes;
