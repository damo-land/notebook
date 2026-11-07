// Interaction QA: drives real taps through each flow and saves a screenshot
// before and after every step, so layout bugs that only appear after an
// interaction (keyboard up/down, sheets closing, navigating back, the undo
// bar coming and going) are visible. Screenshots land in SHOTS_DIR.

import XCTest

final class InteractionTests: XCTestCase {
    private var app: XCUIApplication!
    private let dir = ProcessInfo.processInfo.environment["SHOTS_DIR"]
        ?? "/private/tmp/claude-501/-Users-damo-Desktop-damo-code-notebook/bdd12b96-b72a-4bdf-ba36-52f19a6a4553/scratchpad/ui-qa"

    override func setUp() {
        continueAfterFailure = true
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        app = XCUIApplication()
        app.launchArguments = ["-sampleVault", "-fakeChat", "-demoAnswers", "-resetUI"]
    }

    private func shot(_ name: String) {
        Thread.sleep(forTimeInterval: 0.8) // let animations settle
        let data = XCUIScreen.main.screenshot().pngRepresentation
        try? data.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
    }

    /// A list row whose accessibility label starts with `title`.
    private func row(_ title: String) -> XCUIElement {
        let text = app.staticTexts[title]
        if text.exists { return text }
        return app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    private func textInput(_ placeholder: String) -> XCUIElement {
        let field = app.textFields[placeholder]
        return field.exists ? field : app.textViews[placeholder]
    }

    // MARK: Tasks: complete, undo bar, filter chip, completed section

    func test01_tasks() {
        app.launch()
        shot("01-01-tasks")
        app.buttons["Complete"].firstMatch.tap()
        shot("01-02-after-complete-undo-bar")
        Thread.sleep(forTimeInterval: 7)
        shot("01-03-after-undo-bar-gone")

        app.buttons["More"].tap()
        shot("01-04-more-menu")
        app.buttons["#work"].firstMatch.tap()
        shot("01-05-filtered-work-chip")
        app.buttons["Clear filter #work"].tap()
        shot("01-06-filter-cleared")

        app.buttons["More"].tap()
        app.buttons["Show completed"].firstMatch.tap()
        shot("01-07-show-completed")
        app.swipeUp()
        shot("01-08-scrolled")
        app.swipeDown()
        shot("01-09-scrolled-back")
    }

    // MARK: Task detail: open, mark done, back

    func test02_detailAndBack() {
        app.launch()
        app.staticTexts["Book train tickets for Berlin"].tap()
        shot("02-01-task-detail")
        app.buttons["Complete"].firstMatch.tap()
        shot("02-02-task-detail-done")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        shot("02-03-back-to-tasks")
    }

    // MARK: Capture sheet with chips, date picker, keyboard

    func test03_capture() {
        app.launch()
        app.buttons["New"].tap()
        shot("03-01-capture-open")
        let field = textInput("What needs doing?")
        if field.exists { field.tap(); field.typeText("Call the landlord about the boiler") }
        shot("03-02-typed")
        app.buttons["Deadline"].tap()
        shot("03-03-deadline-menu")
        app.buttons["Tomorrow"].tap()
        app.buttons["Category"].tap()
        app.buttons["#travel"].firstMatch.tap()
        shot("03-04-chips-set")
        app.buttons["Due tomorrow"].tap()
        app.buttons["Pick a date…"].tap()
        shot("03-05-date-picker")
        app.buttons.matching(identifier: "Knowledge").allElementsBoundByIndex.last?.tap()
        shot("03-06-switched-to-knowledge")
        app.buttons["Cancel"].tap()
        shot("03-07-after-cancel")
    }

    // MARK: Notes search with keyboard up and down

    func test04_search() {
        app.launch()
        app.buttons["Knowledge"].tap()
        shot("04-01-knowledge")
        let search = app.textFields.firstMatch
        search.tap()
        shot("04-02-search-focused")
        search.typeText("agent")
        shot("04-03-search-typed")
        app.swipeDown() // dismiss keyboard by scrolling
        shot("04-04-keyboard-dismissed")
        app.buttons["Clear search"].tap()
        shot("04-05-search-cleared")
        app.buttons["Notes"].tap()
        shot("04-06-notes")
    }

    // MARK: Note detail, edit with keyboard, save, back

    func test05_editNote() {
        app.launch()
        app.buttons["Knowledge"].tap()
        row("Agent orchestration patterns").tap()
        shot("05-01-note")
        app.buttons["Edit"].tap()
        shot("05-02-editing-keyboard")
        app.typeText("\nAdded a line from the phone.")
        shot("05-03-typed")
        app.buttons["Save"].tap()
        shot("05-04-after-save")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        shot("05-05-back")
    }

    // MARK: Chat: empty, keyboard, send, dismiss keyboard, close, reopen

    func test06_chat() {
        app.launch()
        app.buttons["Chat"].tap()
        shot("06-01-chat-empty")
        let input = textInput("Ask about your notes")
        input.tap()
        shot("06-02-chat-empty-keyboard")
        input.typeText("What's due this week?")
        app.buttons["Send"].tap()
        Thread.sleep(forTimeInterval: 4)
        shot("06-03-chat-answer-keyboard")
        app.swipeDown()
        shot("06-04-chat-keyboard-dismissed")
        input.tap()
        input.typeText("What did I note about agents")
        app.buttons["Send"].tap()
        Thread.sleep(forTimeInterval: 4)
        shot("06-05-chat-second-answer")
        app.buttons["Close"].tap()
        shot("06-06-home-after-chat")
        app.buttons["Chat"].tap()
        shot("06-07-chat-reopened")
        app.navigationBars["Chat"].buttons["New"].tap()
        shot("06-08-chat-new")
    }

    // MARK: Settings sheet open and close

    func test07_settings() {
        app.launch()
        app.buttons["More"].tap()
        app.buttons["Settings"].tap()
        shot("07-01-settings")
        app.swipeUp()
        shot("07-02-settings-scrolled")
        app.buttons["Done"].tap()
        shot("07-03-after-settings")
    }

    // MARK: Empty tasks after completing everything, then undo

    func test09_emptyAndUndo() {
        app.launch()
        for _ in 0..<5 {
            let c = app.buttons["Complete"].firstMatch
            if c.exists { c.tap(); Thread.sleep(forTimeInterval: 0.4) }
        }
        shot("09-01-all-complete")
        app.buttons["Undo"].tap()
        shot("09-02-after-undo")
    }

    // MARK: Long chat: many messages, keyboard up and down, scroll

    func test10_longChat() {
        app.launch()
        app.buttons["Chat"].tap()
        let input = textInput("Ask about your notes")
        for q in ["What's due this week?", "What's on my plate?", "Any tasks?", "What's due this week?"] {
            input.tap()
            input.typeText(q)
            app.buttons["Send"].tap()
            Thread.sleep(forTimeInterval: 3)
        }
        shot("10-01-long-chat-keyboard")
        app.swipeDown()
        shot("10-02-long-chat-no-keyboard")
        app.swipeDown()
        app.swipeDown()
        shot("10-03-long-chat-scrolled-top")
        input.tap()
        shot("10-04-long-chat-keyboard-again")
    }

    // MARK: Large text: main screens at an accessibility size

    func test08_largeText() {
        app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"]
        app.launch()
        shot("08-01-tasks-large")
        app.buttons["Notes"].tap()
        shot("08-02-notes-large")
        app.buttons["Knowledge"].tap()
        row("Agent orchestration patterns").tap()
        shot("08-03-note-large")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["New"].tap()
        shot("08-04-capture-large")
    }
}
