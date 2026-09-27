// Shared retrieval-practice quiz widget for lessons in this workspace.
// Markup contract:
// <div class="quiz">
//   <p class="quiz-prompt">...</p>
//   <div class="quiz-options">
//     <label><input type="radio" name="UNIQUE_NAME" value="a"> option text</label>
//     ...
//   </div>
//   <button class="quiz-check" data-answer="b" data-explain="why b is right">Check answer</button>
//   <p class="quiz-feedback" hidden></p>
// </div>
(function () {
  function grade(quiz) {
    var button = quiz.querySelector(".quiz-check");
    var feedback = quiz.querySelector(".quiz-feedback");
    var selected = quiz.querySelector('input[type="radio"]:checked');
    if (!selected) {
      feedback.hidden = false;
      feedback.textContent = "Pick an answer first.";
      feedback.className = "quiz-feedback quiz-feedback--nudge";
      return;
    }
    var correct = selected.value === button.getAttribute("data-answer");
    var explain = button.getAttribute("data-explain") || "";
    feedback.hidden = false;
    feedback.className = "quiz-feedback " + (correct ? "quiz-feedback--correct" : "quiz-feedback--incorrect");
    feedback.textContent = (correct ? "Correct. " : "Not quite. ") + explain;
  }

  function init() {
    document.querySelectorAll(".quiz").forEach(function (quiz) {
      var button = quiz.querySelector(".quiz-check");
      if (button) button.addEventListener("click", function () { grade(quiz); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
