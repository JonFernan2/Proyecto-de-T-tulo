import React from 'react';
import { useGradingStore } from './store/useGradingStore.js';
import Header from './components/Header.jsx';
import StepBar from './components/StepBar.jsx';
import Step1_DeliverySetup from './components/Step1_DeliverySetup.jsx';
import Step2_FileUpload from './components/Step2_FileUpload.jsx';
import Step3_Admissibility from './components/Step3_Admissibility.jsx';
import Step4_EvalLoading from './components/Step4_EvalLoading.jsx';
import Step5_Results from './components/Step5_Results.jsx';

const STEP_LABELS = ['Configuración', 'Archivos', 'Admisibilidad', 'Evaluando', 'Resultados'];
const STEP_KEYS = ['setup', 'upload', 'admissibility', 'evaluating', 'results'];

export default function App() {
  const step = useGradingStore(s => s.step);
  const stepIndex = STEP_KEYS.indexOf(step);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <StepBar steps={STEP_LABELS} current={stepIndex} />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {step === 'setup' && <Step1_DeliverySetup />}
        {step === 'upload' && <Step2_FileUpload />}
        {step === 'admissibility' && <Step3_Admissibility />}
        {step === 'evaluating' && <Step4_EvalLoading />}
        {step === 'results' && <Step5_Results />}
      </main>
    </div>
  );
}
