function createClinicRuntime({
  bookingSystemPrompt
}) {
  const liveServicePriceCache = {};
  const LIVE_PRICE_CACHE_MS =
    60 * 1000;

  const liveClinicKnowledgeCache = {};
  const LIVE_KNOWLEDGE_CACHE_MS =
    60 * 1000;

  function formatClinicServices(clinic) {
    return (clinic.services || [])
      .map(function(service) {
        const potential =
          service.potentialServiceName
            ? (
                " Potential next service: " +
                service.potentialServiceName +
                " (" +
                clinic.currencySymbol +
                service.potentialServiceValueMin
                  ?.toLocaleString() +
                "–" +
                clinic.currencySymbol +
                service.potentialServiceValueMax
                  ?.toLocaleString() +
                ")."
              )
            : "";

        return (
          "- " +
          service.name +
          ": " +
          service.priceText +
          "; approximately " +
          service.durationMinutes +
          " minutes." +
          potential
        );
      })
      .join("\n");
  }

  function formatClinicKnowledge(
    knowledge
  ) {
    const facts =
      knowledge?.facts || [];

    if (!facts.length) {
      return (
        "No additional approved clinic facts " +
        "are currently available."
      );
    }

    return facts
      .map(function(fact) {
        const wording =
          fact.publicWording ||
          fact.value ||
          "";

        return (
          "- " +
          fact.category +
          " / " +
          fact.field +
          ": " +
          wording
        );
      })
      .join("\n");
  }

  function buildClinicBookingPrompt(
    clinic,
    knowledge = null
  ) {
    const hours =
      Object.entries(
        clinic.openingHours || {}
      )
        .map(function(entry) {
          return (
            entry[0] +
            ": " +
            entry[1]
          );
        })
        .join("\n");

    return `
${bookingSystemPrompt}

CURRENT CLINIC
Clinic ID: ${clinic.clinicId}
Clinic name: ${clinic.clinicName}
Assistant name: ${clinic.assistantName}
Clinic type: ${clinic.clinicType}
Location: ${clinic.city}, ${clinic.country}
Timezone: ${clinic.timezone}
Currency: ${clinic.currency}
Languages: ${(clinic.languages || []).join(", ")}

RECEPTIONIST VOICE
${clinic.receptionistStyle || "Warm, concise, professional and reassuring."}

OPENING HOURS
${hours}

AVAILABLE DEMO REQUEST TIMES
${(clinic.availableSlots || []).join(", ")}
The clinic must still confirm availability.

APPOINTMENT-TIME RULES
- Never silently change a time requested by the patient.
- The patient's latest explicit time selection is the authoritative requested time.
- If the requested time is not in AVAILABLE DEMO REQUEST TIMES, clearly say it is not among the currently shown times and offer the exact available alternatives.
- Only replace the requested time after the patient explicitly selects or accepts another time.
- Do not describe a booking as confirmed until the clinic confirms it.

SERVICES AND PRICES
${formatClinicServices(clinic)}

APPROVED CLINIC KNOWLEDGE
${formatClinicKnowledge(knowledge)}

KNOWLEDGE RULES
- Treat APPROVED CLINIC KNOWLEDGE as the clinic-approved source of truth.
- Use the approved public wording when answering patients.
- Do not mention the Clinic KB, Google Sheets, approval status, or internal sources.
- If approved knowledge conflicts with older hard-coded clinic information, follow the approved knowledge.
- If the requested fact is absent, do not guess. Say the clinic team will confirm.
- Never weaken or make a Clinic KB policy more absolute than its approved public wording.
- When a Clinic KB policy exists, do not combine it with conflicting or broader fallback wording.
- Do not turn conditional wording into a definite yes/no claim.
- For insurance, say only what the approved KB states. If coverage varies by provider or plan, do not say “the clinic accepts insurance” unless the KB explicitly confirms that.

BOOKING AND CLINIC POLICIES

Use APPROVED CLINIC KNOWLEDGE first for:
- same-day booking rules
- clinic confirmation requirements
- deposits
- cancellations
- late arrival guidance
- insurance
- payment methods
- emergency instructions

If an approved fact is not available, use these fallback defaults:

Same-day requests: ${clinic.bookingRules?.sameDayAllowed ? "Allowed when available" : "Not offered"}
Clinic confirmation required: ${clinic.bookingRules?.confirmationRequired ? "Yes" : "No"}
Deposit fallback: If no approved Clinic KB deposit policy is available, ask the clinic team to confirm.
Insurance fallback: If no approved Clinic KB insurance policy is available, ask the clinic team to confirm.
Late arrival guidance: Please alert the clinic if more than ${clinic.bookingRules?.lateArrivalMinutes || 15} minutes late.
Insurance: ${clinic.insurancePolicy}
Payment methods: ${(clinic.paymentMethods || []).join(", ")}
Emergency instruction fallback: ${clinic.bookingRules?.emergencyInstruction}

FINAL IDENTITY RULES
You are ${clinic.assistantName}, the booking receptionist for ${clinic.clinicName}.
Do not mention another clinic.
Do not mention Eden or ClinicNet unless the patient explicitly asks who powers the chat; then answer briefly that the clinic uses Eden Clinic Network technology.
Do not invent clinic information.
`;
  }

  async function getLiveServicePrices(
    clinic
  ) {
    const intakeUrl =
      clinic.googleSheets?.intakeUrl;

    if (!intakeUrl) {
      return {};
    }

    const cacheKey =
      clinic.clinicId;

    const cached =
      liveServicePriceCache[
        cacheKey
      ];

    if (
      cached &&
      Date.now() -
        cached.loadedAt <
        LIVE_PRICE_CACHE_MS
    ) {
      return cached.prices;
    }

    try {
      const priceUrl =
        clinic.googleSheets
          ?.knowledgeUrl ||
        clinic.googleSheets
          ?.intakeUrl;

      const separator =
        priceUrl.includes("?")
          ? "&"
          : "?";

      const response =
        await fetch(
          priceUrl +
            separator +
            "action=prices"
        );

      if (!response.ok) {
        throw new Error(
          "Price catalogue request failed"
        );
      }

      const data =
        await response.json();

      const prices =
        data?.success &&
        data?.prices
          ? data.prices
          : {};

      const services =
        data?.success &&
        Array.isArray(
          data?.services
        )
          ? data.services
          : [];

      liveServicePriceCache[
        cacheKey
      ] = {
        loadedAt:
          Date.now(),
        prices,
        services
      };

      return prices;
    } catch (error) {
      console.warn(
        "Live service prices unavailable for:",
        clinic.clinicName,
        error.message
      );

      return {};
    }
  }

  async function getLiveClinicKnowledge(
    clinic
  ) {
    const knowledgeUrl =
      clinic.googleSheets
        ?.knowledgeUrl;

    if (!knowledgeUrl) {
      return null;
    }

    const cacheKey =
      clinic.clinicId;

    const cached =
      liveClinicKnowledgeCache[
        cacheKey
      ];

    if (
      cached &&
      Date.now() -
        cached.loadedAt <
        LIVE_KNOWLEDGE_CACHE_MS
    ) {
      return cached.knowledge;
    }

    try {
      const separator =
        knowledgeUrl.includes("?")
          ? "&"
          : "?";

      const response =
        await fetch(
          knowledgeUrl +
            separator +
            "action=knowledge"
        );

      if (!response.ok) {
        throw new Error(
          "Clinic knowledge request failed"
        );
      }

      const data =
        await response.json();

      const knowledge =
        data?.success &&
        data?.knowledge
          ? data.knowledge
          : null;

      liveClinicKnowledgeCache[
        cacheKey
      ] = {
        loadedAt:
          Date.now(),
        knowledge
      };

      return knowledge;
    } catch (error) {
      console.warn(
        "Live clinic knowledge unavailable for:",
        clinic.clinicName,
        error.message
      );

      return null;
    }
  }

  async function getClinicWithLiveServicePrices(
    clinic
  ) {
    const prices =
      await getLiveServicePrices(
        clinic
      );

    function normalisePriceLabel(
      value
    ) {
      return String(value || "")
        .toLowerCase()
        .trim()
        .replace(
          /[^a-z0-9]+/g,
          " "
        )
        .replace(/\s+/g, " ")
        .trim();
    }

    const standardPriceLabels = {
      smile_assessment: [
        "Dental Consultation",
        "General Consultation",
        "Check-up"
      ],
      scaling_polishing: [
        "Teeth Cleaning",
        "Scaling & Polishing"
      ],
      teeth_whitening: [
        "Teeth Whitening"
      ],
      veneers_consultation: [
        "Veneers Consultation",
        "Smile Makeover Consultation"
      ],
      orthodontics_consultation: [
        "Braces Consultation",
        "Clear Aligner Consultation"
      ],
      implant_consultation: [
        "Implant Consultation",
        "Dental Implant Consultation"
      ],
      emergency_dental: [
        "Emergency / Tooth Pain",
        "Emergency Dental Assessment"
      ]
    };

    const pricesByKey = {};

    Object.keys(
      prices || {}
    ).forEach(function(label) {
      pricesByKey[
        normalisePriceLabel(
          label
        )
      ] = prices[label];
    });

    const structuredServices =
      liveServicePriceCache[
        clinic.clinicId
      ]?.services || [];

    return {
      ...clinic,
      services:
        (clinic.services || [])
          .map(function(service) {
            const labelsToCheck =
              [service.name]
                .concat(
                  service.priceLabels ||
                    []
                )
                .concat(
                  standardPriceLabels[
                    service.id
                  ] || []
                );

            const normalisedLabels =
              labelsToCheck.map(
                normalisePriceLabel
              );

            const catalogueItem =
              structuredServices.find(
                function(item) {
                  const catalogueLabels =
                    [item.service]
                      .concat(
                        item.aliases ||
                          []
                      )
                      .map(
                        normalisePriceLabel
                      );

                  return catalogueLabels
                    .some(
                      function(label) {
                        return normalisedLabels
                          .includes(
                            label
                          );
                      }
                    );
                }
              );

            let liveValue = null;

            for (
              const label of
              labelsToCheck
            ) {
              const candidate =
                Number(
                  pricesByKey[
                    normalisePriceLabel(
                      label
                    )
                  ]
                );

              if (
                Number.isFinite(
                  candidate
                ) &&
                candidate > 0
              ) {
                liveValue =
                  candidate;
                break;
              }
            }

            if (
              !liveValue &&
              catalogueItem
            ) {
              const candidate =
                Number(
                  catalogueItem
                    .suggestedValue ||
                  catalogueItem
                    .minimumPrice
                );

              if (
                Number.isFinite(
                  candidate
                ) &&
                candidate > 0
              ) {
                liveValue =
                  candidate;
              }
            }

            if (
              !liveValue &&
              !catalogueItem
            ) {
              return service;
            }

            const fallbackPriceText =
              liveValue
                ? (
                    "Standard clinic price: " +
                    clinic.currencySymbol +
                    Number(
                      liveValue
                    ).toLocaleString()
                  )
                : service.priceText;

            return {
              ...service,
              estimatedVisitValue:
                liveValue ||
                service
                  .estimatedVisitValue,
              priceType:
                catalogueItem
                  ?.priceType ||
                service.priceType ||
                "Fixed",
              minimumPrice:
                Number(
                  catalogueItem
                    ?.minimumPrice
                ) ||
                liveValue ||
                0,
              maximumPrice:
                Number(
                  catalogueItem
                    ?.maximumPrice
                ) ||
                0,
              consultationFee:
                Number(
                  catalogueItem
                    ?.consultationFee
                ) ||
                0,
              priceAliases:
                catalogueItem
                  ?.aliases || [],
              priceText:
                catalogueItem
                  ?.publicWording ||
                fallbackPriceText
            };
          })
    };
  }

  return {
    formatClinicServices,
    formatClinicKnowledge,
    buildClinicBookingPrompt,
    getLiveServicePrices,
    getLiveClinicKnowledge,
    getClinicWithLiveServicePrices
  };
}

module.exports = {
  createClinicRuntime
};
