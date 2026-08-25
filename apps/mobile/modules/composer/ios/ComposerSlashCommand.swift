import ExpoModulesCore

/// One slash command or skill the active agent can run, handed over as data.
///
/// Carries no behaviour, like `ComposerQuickKey`: selection is purely textual
/// — the composer replaces the draft with the committed token and the caller
/// hears about it through `onDraftChange` like any other keystroke.
struct ComposerSlashCommand: Record, Identifiable, Equatable {
  @Field var id: String = ""
  /// Full display name, namespace included (`agent-sdk-dev:new-sdk-app`).
  @Field var name: String = ""
  @Field var descriptionText: String? = nil
  /// The sigil that opens and commits this entry: `/`, or `$` for Codex skills.
  @Field var trigger: String = "/"
  /// Non-empty when the command takes arguments; the menu stays out of the
  /// way once such a command is fully typed.
  @Field var argumentHint: String? = nil
  /// Harness-shipped commands sort after user-defined ones, like desktop.
  @Field var isBuiltin: Bool = false

  static func == (lhs: ComposerSlashCommand, rhs: ComposerSlashCommand) -> Bool {
    lhs.id == rhs.id && lhs.name == rhs.name
      && lhs.descriptionText == rhs.descriptionText
      && lhs.trigger == rhs.trigger && lhs.argumentHint == rhs.argumentHint
      && lhs.isBuiltin == rhs.isBuiltin
  }
}

/// The suggestion state derived from the draft — nil when the panel is hidden.
struct ComposerSlashSuggestionState: Equatable {
  var query: String
  var matches: [ComposerSlashCommand]
}

enum ComposerSlashMatching {
  /// The active token: the draft *is* a trigger token and nothing else — one
  /// sigil, no whitespace after it. Suggestions stay out of the way the
  /// moment the command gains arguments or the draft becomes prose.
  static func activeToken(draft: String) -> (trigger: String, query: String)? {
    guard let first = draft.first, first == "/" || first == "$" else { return nil }
    let query = String(draft.dropFirst())
    guard !query.contains(where: { $0.isWhitespace || $0.isNewline }) else { return nil }
    return (String(first), query)
  }

  /// Exact > prefix > substring, mirroring shared `getCommandMatchRank`.
  static func rank(name: String, query: String) -> Int? {
    if query.isEmpty { return 0 }
    let name = name.lowercased()
    if name == query { return 0 }
    if name.hasPrefix(query) { return 1 }
    if name.contains(query) { return 2 }
    return nil
  }

  static func suggestions(
    draft: String,
    commands: [ComposerSlashCommand]
  ) -> ComposerSlashSuggestionState? {
    guard let token = activeToken(draft: draft), !commands.isEmpty else { return nil }
    let query = token.query.lowercased()
    // A fully typed command that takes arguments keeps the panel closed —
    // mirrors shared `shouldSuppressSlashMenuForCommittedCommand`.
    if commands.contains(where: { command in
      command.trigger == token.trigger && command.name.lowercased() == query
        && !(command.argumentHint ?? "").trimmingCharacters(in: .whitespaces).isEmpty
    }) {
      return nil
    }
    let matches = commands
      .compactMap { command -> (ComposerSlashCommand, Int)? in
        guard command.trigger == token.trigger else { return nil }
        guard let rank = rank(name: command.name, query: query) else { return nil }
        return (command, rank)
      }
      .sorted { lhs, rhs in
        if lhs.1 != rhs.1 { return lhs.1 < rhs.1 }
        if lhs.0.isBuiltin != rhs.0.isBuiltin { return !lhs.0.isBuiltin }
        return lhs.0.name < rhs.0.name
      }
      .map(\.0)
    guard !matches.isEmpty else { return nil }
    return ComposerSlashSuggestionState(query: query, matches: matches)
  }
}
