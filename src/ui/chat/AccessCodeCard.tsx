import { Component, createSignal } from "solid-js";
import { Lock, ArrowRight, Check } from "lucide-solid";

export interface AccessCodeCardProps {
  onUnlock: (code: string) => Promise<boolean>;
  loading?: boolean;
}

export const AccessCodeCard: Component<AccessCodeCardProps> = (props) => {
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);
  const [success, setSuccess] = createSignal(false);

  const handleSubmit = async (e?: Event) => {
    e?.preventDefault();
    const val = code().trim();
    if (!val || submitting()) return;

    setError(null);
    setSubmitting(true);
    try {
      const ok = await props.onUnlock(val);
      if (ok) {
        setSuccess(true);
      } else {
        setError("Incorrect access code. Please try again.");
      }
    } catch {
      setError("Failed to verify access code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="rounded-2xl bg-black/[0.035] p-3.5 flex flex-col gap-2.5 my-1">
      <div class="flex items-start gap-2.5">
        <div class="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center shrink-0 mt-0.5">
          <Lock size={13} />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-medium text-neutral-900 leading-snug">Access code required</div>
          <div class="text-[11px] text-neutral-500 leading-normal mt-0.5">
            Enter the access code to enable the AI design assistant.
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} class="flex items-center gap-1.5 mt-0.5">
        <input
          type="password"
          value={code()}
          onInput={(e) => {
            setCode(e.currentTarget.value);
            if (error()) setError(null);
          }}
          placeholder="Enter access code..."
          disabled={submitting() || success()}
          class="flex-1 bg-white border border-black/10 rounded-xl px-2.5 py-1.5 text-[12px] text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!code().trim() || submitting() || success()}
          class="h-8 px-3 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white text-[12px] font-medium flex items-center gap-1 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          {success() ? (
            <>
              <Check size={12} stroke-width={2.5} />
              <span>Unlocked</span>
            </>
          ) : submitting() ? (
            <span>Verifying...</span>
          ) : (
            <>
              <span>Unlock</span>
              <ArrowRight size={12} />
            </>
          )}
        </button>
      </form>

      {error() && (
        <div class="text-[11px] text-rose-600 font-medium px-0.5">{error()}</div>
      )}
    </div>
  );
};
