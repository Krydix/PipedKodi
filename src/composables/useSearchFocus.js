import { ref } from "vue";

// Shared counter — NavBar watches this and focuses the input whenever it ticks.
const focusTrigger = ref(0);

export function useSearchFocus() {
    function triggerSearchFocus() {
        focusTrigger.value++;
    }

    return { focusTrigger, triggerSearchFocus };
}
