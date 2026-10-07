# Exploration touch fixture: CDP emulation ownership

The final full-run failure occurred in the second width iteration, 375px. The 320px iteration passed filters and search. Trace tap call6240 found Filtros visible/enabled/stable at x83.5,y156 and completed; the next call waited for the absent dialog. No pageError was present. Screencast frames immediately after the tap showed the catalog scrolling down rather than a drawer. The trace alone did not identify why that tap failed to open the dialog.

A minimal installed-Chromium experiment established a deterministic fixture problem. BrowserContext(hasTouch:true,isMobile:true) started with navigator.maxTouchPoints=1 and pointer:coarse=true. A secondary CDP session called Emulation.setTouchEmulationEnabled and then detached. Chromium then reported maxTouchPoints=0 and pointer:coarse=false, overriding the context's intended mobile input state. Plain-button Playwright taps still generated pointer/touch/click events; therefore the hypothesis that all later taps are ignored is false.

An Input-only secondary session, sending dispatchTouchEvent without overriding Emulation, preserved maxTouchPoints=1 and pointer:coarse=true after detach. The least invasive fixture correction is to let BrowserContext own emulation and use temporary CDP solely for Input commands.

The original isolated exploration touch test passed once in 11.6 seconds. A temporary copy with the redundant Emulation override removed and explicit post-detach touch-state assertions passed once in 10.3 seconds at both 320 and 375px; swipe, filter selection and search succeeded. No production defect was reproduced or production source change proposed. The exact association between the full-run missed tap and the invalid emulation state remains unproven; the state drift itself is directly reproduced.

Evidence: touch-cdp.json, touch-isolated.log, touch-input-only.log. All browser requests in the exploration flows used synthetic fixtures. Temporary harness changes stayed in /tmp; only sanitized evidence was written in the repository. No raw trace or credentials were copied.
