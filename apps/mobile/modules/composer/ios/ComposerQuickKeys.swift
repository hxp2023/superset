import SwiftUI

/// The terminal's quick keys — esc/tab/arrows the soft keyboard lacks — as a
/// scrolling strip above the card.
///
/// Native, and not negotiable about it. These used to be React Native siblings
/// of the composer, and the gap to the pill was a hardcoded guess at a height
/// the host view under-reported: it drifted whenever the pill grew and animated
/// on its own curve. Inside the composer's tree the gap is one stack spacing.
///
/// Only the *shape* of a key crosses the bridge. What each one writes into the
/// PTY is React Native's business — the composer reports an id and forgets.
struct ComposerQuickKeys: View {
  let keys: [ComposerQuickKey]
  let onPress: (String) -> Void

  var body: some View {
    ScrollView(.horizontal) {
      // Glass here, unlike the controls inside the card. Apple's layer economy
      // is one sheet per surface: the card's buttons sit *on* its glass and so
      // take solid fills, but this strip floats over the terminal as a surface
      // of its own, which is the case `.glass` is built for. The container lets
      // the system render the row in one pass and merge neighbours as they
      // scroll, and it brings press feedback, hit slop, Increase Contrast and
      // Reduce Transparency with it — all things a hand-rolled fill has to fake.
      GlassEffectContainer(spacing: ComposerMetrics.quickKeySpacing) {
        HStack(spacing: ComposerMetrics.quickKeySpacing) {
          ForEach(keys) { key in
            Button { onPress(key.id) } label: {
              label(for: key)
                .frame(minWidth: ComposerMetrics.quickKeyMinWidth)
            }
            .buttonStyle(.glass)
            .buttonBorderShape(.capsule)
            .accessibilityLabel(key.label ?? key.id)
          }
        }
      }
      .padding(.horizontal, ComposerMetrics.horizontalMargin)
    }
    .scrollIndicators(.hidden)
    // Let the system size the buttons — pinning a height is what made the old
    // row fight the style's own padding.
    .scrollClipDisabled()
  }

  @ViewBuilder
  private func label(for key: ComposerQuickKey) -> some View {
    if let symbol = key.symbol, !symbol.isEmpty {
      Image(systemName: symbol)
        .font(.system(size: ComposerMetrics.quickKeyGlyphSize))
    } else {
      Text(key.label ?? "")
        .font(.system(size: ComposerMetrics.quickKeyGlyphSize, design: .monospaced))
    }
  }
}
