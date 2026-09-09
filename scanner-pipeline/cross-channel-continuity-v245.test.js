const assert = require('node:assert/strict');
const { buildCrossChannelContinuity } = require('./cross-channel-continuity-v245');

function alignedManifest() {
  return {
    reviewedUrl: 'https://clinic.example/',
    phoneDisplayedNumbers: ['038 123 456'],
    googleBusiness: {
      evidence: {
        branches: [{
          identityIsolation: { qualified: true },
          profile: {
            website: 'https://clinic.example/',
            phone: '038123456'
          },
          conversionDestination: {
            targetUrl: 'https://clinic.example/',
            finalUrl: 'https://clinic.example/contact'
          },
          bookingDestination: {
            targetUrl: 'https://book.vendor.example/clinic',
            finalUrl: 'https://book.vendor.example/clinic'
          }
        }]
      }
    },
    facebook: {
      probe: {
        page: {
          websiteUrl: 'https://clinic.example/',
          phone: '038123456'
        },
        actions: {
          bookButtonPresent: true,
          bookButtonWorks: true,
          bookButtonTarget: 'https://book.vendor.example/clinic',
          bookButtonFinalUrl: 'https://book.vendor.example/clinic',
          messageButtonPresent: true,
          whatsappButtonPresent: true,
          callButtonPresent: true
        }
      }
    },
    journeyEvidence: {
      confidence: 'verified',
      continuity: {
        targetUrl: 'https://book.vendor.example/clinic',
        finalUrl: 'https://book.vendor.example/clinic'
      }
    }
  };
}

{
  const result = buildCrossChannelContinuity(alignedManifest());
  assert.equal(result.summary.blockingContradictionCount, 0);
  assert(
    result.claims.some(
      x => x.id === 'continuity-google-website' &&
           x.value === true
    )
  );
  assert(
    result.claims.some(
      x => x.id === 'continuity-facebook-booking' &&
           x.value === true
    )
  );
  assert.equal(result.channelMatrix.facebook.actions.whatsapp, true);
}

{
  const manifest = alignedManifest();
  manifest.facebook.probe.page.websiteUrl = 'https://stale.example/';
  manifest.googleBusiness.evidence.branches[0].bookingDestination.finalUrl =
    'https://old-booking.example/clinic';

  const result = buildCrossChannelContinuity(manifest);

  assert(
    result.contradictions.some(
      x => x.id === 'continuity-facebook-website-mismatch' &&
           x.blocksPublication === true
    )
  );

  assert(
    result.contradictions.some(
      x => x.id === 'continuity-google-booking-mismatch' &&
           x.blocksPublication === true
    )
  );
}

{
  const result = buildCrossChannelContinuity({
    reviewedUrl: 'https://clinic.example/',
    facebook: {
      probe: {
        actions: {
          messageButtonStatus: 'not-observed',
          whatsappButtonStatus: 'login-limited'
        }
      }
    }
  });

  assert(
    result.gaps.some(x => x.id === 'continuity-google-website-unverified')
  );
  assert(
    result.gaps.some(x => x.id === 'continuity-facebook-message-unknown')
  );
  assert.equal(
    result.contradictions.some(x => x.id === 'continuity-facebook-message-mismatch'),
    false
  );
}

console.log(
  'PASS: V2.4.5 cross-channel website, booking, phone and Facebook action continuity with mismatch gating and unknown-state protection.'
);
