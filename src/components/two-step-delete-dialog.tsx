'use client';

import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

type TwoStepDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Primera pregunta, p. ej. «¿Seguro que quieres eliminar este examen?» */
  firstQuestion: string;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
};

export function TwoStepDeleteDialog({
  open,
  onOpenChange,
  firstQuestion,
  onConfirm,
  confirming = false,
}: TwoStepDeleteDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

  const handleClose = (nextOpen: boolean) => {
    if (confirming) return;
    if (!nextOpen) setStep(1);
    onOpenChange(nextOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="gap-5 rounded-xl border border-gray-200 bg-white p-6 shadow-lg sm:max-w-md">
        <AlertDialogHeader className="gap-2 text-center sm:text-center">
          <AlertDialogTitle className="text-lg font-semibold text-gray-900">
            {step === 1 ? firstQuestion : '¿Estás seguro?'}
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            {step === 1
              ? 'Confirma si deseas continuar con la eliminación.'
              : 'Confirma de nuevo para eliminar de forma definitiva.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row justify-center gap-3 sm:justify-center">
          <AlertDialogCancel
            type="button"
            className="mt-0 min-w-[5.5rem] rounded-lg border-gray-200 bg-white hover:bg-gray-50"
            disabled={confirming}
          >
            No
          </AlertDialogCancel>
          {step === 1 ? (
            <Button
              type="button"
              className="min-w-[5.5rem] rounded-lg bg-orange-600 text-white hover:bg-orange-700"
              disabled={confirming}
              onClick={() => setStep(2)}
            >
              Sí
            </Button>
          ) : (
            <Button
              type="button"
              className="min-w-[5.5rem] rounded-lg bg-red-600 text-white hover:bg-red-700"
              disabled={confirming}
              onClick={() => void onConfirm()}
            >
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sí'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
